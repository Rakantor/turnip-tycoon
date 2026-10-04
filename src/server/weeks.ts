import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Transaction } from '../db/connection';
import { mutations, priceEntries, weeks } from '../db/schema';
import { inferPreviousPattern } from '../prediction/previous-pattern';
import { shiftWeek } from '../shared/calendar';
import { emptyWeek, type PatternId, type WeekRecord } from '../shared/week';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import { readJson } from './http';
import { hashSecret } from './secrets';

const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() > 0 &&
      date.toISOString().slice(0, 10) === value
    );
  });
const sundayInput = dateInput.refine((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 0);
const mutationInput = z
  .object({
    mutationId: z.string().uuid(),
    baseRevision: z.number().int().min(0).max(2_147_483_646),
    purchasePrice: z.number().int().min(90).max(110).nullable(),
    firstBuy: z.boolean().nullable(),
    previousPattern: z.enum(['fluctuating', 'large-spike', 'decreasing', 'small-spike']).nullable(),
    prices: z.array(z.number().int().min(1).max(660).nullable()).length(12),
  })
  .strict();
export const historyInput = z
  .object({
    before: dateInput.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export function parseWeekStart(value: string): string {
  const result = sundayInput.safeParse(value);
  if (!result.success)
    throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid Sunday for this week.');
  return result.data;
}

export async function attachPrices(
  tx: Transaction,
  records: (typeof weeks.$inferSelect)[],
): Promise<WeekRecord[]> {
  if (!records.length) return [];
  const entries = await tx
    .select()
    .from(priceEntries)
    .where(
      inArray(
        priceEntries.weekId,
        records.map((week) => week.id),
      ),
    );
  return records.map((week) => {
    const prices = Array<number | null>(12).fill(null);
    for (const entry of entries) {
      if (entry.weekId === week.id)
        prices[(entry.day - 1) * 2 + (entry.slot === 'PM' ? 1 : 0)] = entry.price;
    }
    return {
      playerId: week.playerId,
      weekStart: week.weekStart,
      revision: week.revision,
      purchasePrice: week.purchasePrice,
      firstBuy: week.firstBuy,
      previousPattern: week.previousPattern as PatternId | null,
      prices,
    };
  });
}

export async function readWeek(
  tx: Transaction,
  playerId: string,
  weekStart: string,
): Promise<WeekRecord> {
  const records = await tx
    .select()
    .from(weeks)
    .where(and(eq(weeks.playerId, playerId), eq(weeks.weekStart, weekStart)))
    .for('share');
  const stored = (await attachPrices(tx, records))[0];
  if (stored) return stored;

  // A default never overwrites a saved choice or creates a history entry. Read
  // the preceding record directly so missing weeks cannot recurse backwards.
  const preceding = await tx
    .select()
    .from(weeks)
    .where(and(eq(weeks.playerId, playerId), eq(weeks.weekStart, shiftWeek(weekStart, -1))))
    .for('share');
  const previous = (await attachPrices(tx, preceding))[0];
  return {
    ...emptyWeek(playerId, weekStart),
    previousPattern: inferPreviousPattern(previous, playerId, weekStart),
  };
}

export async function readHistory(
  tx: Transaction,
  playerId: string,
  before: string | undefined,
  limit: number,
) {
  const records = await tx
    .select()
    .from(weeks)
    .where(and(eq(weeks.playerId, playerId), before ? lt(weeks.weekStart, before) : undefined))
    .orderBy(desc(weeks.weekStart))
    .limit(limit + 1)
    .for('share');
  const page = records.slice(0, limit);
  return {
    weeks: await attachPrices(tx, page),
    nextCursor: records.length > limit ? page.at(-1)!.weekStart : null,
  };
}

export function registerWeekRoutes(app: Hono<AppEnvironment>): void {
  app.get('/api/weeks', async (c) => {
    const parsed = historyInput.safeParse(c.req.query());
    if (!parsed.success)
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid history date and limit.');
    const { before, limit } = parsed.data;
    const result = await withSession(c.get('db'), await sessionHash(c), (tx, session) =>
      readHistory(tx, session.player.id, before, limit),
    );
    return c.json(result);
  });

  app.get('/api/weeks/:weekStart', async (c) => {
    const weekStart = parseWeekStart(c.req.param('weekStart'));
    const week = await withSession(c.get('db'), await sessionHash(c), (tx, session) =>
      readWeek(tx, session.player.id, weekStart),
    );
    return c.json({ week });
  });

  app.put('/api/weeks/:weekStart', async (c) => {
    const weekStart = parseWeekStart(c.req.param('weekStart'));
    const input = await readJson(c, mutationInput);
    // Hash canonical validated fields, including the destination week. The same
    // mutation ID cannot be reused to apply a different edit or a different week.
    const payloadHash = await hashSecret(JSON.stringify({ weekStart, ...input }));
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const playerId = session.player.id;
      const [replay] = await tx
        .select()
        .from(mutations)
        .where(and(eq(mutations.playerId, playerId), eq(mutations.mutationId, input.mutationId)));
      if (replay) {
        if (replay.payloadHash !== payloadHash)
          throw new ApiError(
            409,
            'MUTATION_REUSED',
            'This save request was already used for a different edit.',
          );
        return { revision: replay.resultingRevision };
      }
      const current = await readWeek(tx, playerId, weekStart);
      if (current.revision !== input.baseRevision) return { week: current };
      const revision = current.revision + 1;
      const values = {
        playerId,
        weekStart,
        revision,
        purchasePrice: input.purchasePrice,
        firstBuy: input.firstBuy,
        previousPattern: input.previousPattern,
      };
      const [saved] = await tx
        .insert(weeks)
        .values(values)
        .onConflictDoUpdate({
          target: [weeks.playerId, weeks.weekStart],
          set: values,
        })
        .returning({ id: weeks.id });
      await tx
        .delete(priceEntries)
        .where(and(eq(priceEntries.weekId, saved.id), eq(priceEntries.playerId, playerId)));
      const entries = input.prices.flatMap((price, index) =>
        price === null
          ? []
          : [
              {
                playerId,
                weekId: saved.id,
                revision,
                day: Math.floor(index / 2) + 1,
                slot: index % 2 ? 'PM' : 'AM',
                price,
              },
            ],
      );
      if (entries.length) await tx.insert(priceEntries).values(entries);
      await tx.insert(mutations).values({
        playerId,
        mutationId: input.mutationId,
        payloadHash,
        resultingRevision: revision,
      });
      return { revision };
    });
    if ('week' in result)
      return c.json(
        {
          error: {
            code: 'REVISION_CONFLICT',
            message: 'This week changed on another device. Review the latest prices before saving.',
          },
          week: result.week,
        },
        409,
      );
    return c.json(result);
  });
}
