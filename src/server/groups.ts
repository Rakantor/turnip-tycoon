import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Transaction } from '../db/connection';
import { groups, memberships, players, weeks } from '../db/schema';
import type { GroupSummary, SharedPlayerWeek } from '../shared/groups';
import { emptyWeek } from '../shared/week';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import { readJson } from './http';
import { formatCode, normalizeCode, randomCode } from './secrets';
import { attachPrices, historyInput, parseWeekStart, readHistory, readWeek } from './weeks';

// A single limit covers creation, admission, and the capacity shown to members.
export const GROUP_CAPACITY = 8;

const createInput = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const joinInput = z
  .object({
    code: z
      .string()
      .max(40)
      .transform(normalizeCode)
      .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{12}$/)),
  })
  .strict();
const uuidInput = z.string().uuid();

function parseId(value: string): string {
  const parsed = uuidInput.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid group or player.');
  return parsed.data;
}

function unavailable(): ApiError {
  return new ApiError(404, 'GROUP_UNAVAILABLE', 'This group is no longer available to you.');
}

function summary(group: typeof groups.$inferSelect, memberCount: number): GroupSummary {
  return {
    id: group.id,
    name: group.name || 'Friend group',
    code: group.shareCode,
    memberCount,
    capacity: GROUP_CAPACITY,
  };
}

async function memberCount(tx: Transaction, groupId: string): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));
  return row.total;
}

async function isMember(tx: Transaction, groupId: string, playerId: string): Promise<boolean> {
  const rows = await tx
    .select({ playerId: memberships.playerId })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.playerId, playerId)));
  return rows.length > 0;
}

// Shared reads hold group locks through reading the members and their prices.
// Departures/admission use the matching update lock, so access is checked again
// after any concurrent membership change and cannot outlive that transaction.
async function lockGroups(tx: Transaction, ids: string[]) {
  if (!ids.length) return [];
  return tx
    .select()
    .from(groups)
    .where(inArray(groups.id, ids))
    .orderBy(asc(groups.id))
    .for('share');
}

async function comparison(tx: Transaction, groupIds: string[], weekStart: string) {
  if (!groupIds.length) return { counts: new Map<string, number>(), players: [] };
  const members = await tx
    .select({ groupId: memberships.groupId, player: players })
    .from(memberships)
    .innerJoin(players, eq(players.id, memberships.playerId))
    .where(inArray(memberships.groupId, groupIds))
    .orderBy(asc(players.displayName), asc(players.id));
  const counts = new Map<string, number>();
  const unique = new Map<string, SharedPlayerWeek>();
  for (const member of members) {
    counts.set(member.groupId, (counts.get(member.groupId) ?? 0) + 1);
    const existing = unique.get(member.player.id);
    if (existing) existing.groupIds.push(member.groupId);
    else
      unique.set(member.player.id, {
        player: member.player,
        groupIds: [member.groupId],
        week: emptyWeek(member.player.id, weekStart),
      });
  }
  if (!unique.size) return { counts, players: [] };
  // Holding each existing week protects the two-query week/price snapshot from
  // a concurrent owner upload. The owner may continue editing other weeks.
  const records = await tx
    .select()
    .from(weeks)
    .where(and(inArray(weeks.playerId, [...unique.keys()]), eq(weeks.weekStart, weekStart)))
    .orderBy(asc(weeks.id))
    .for('share');
  for (const week of await attachPrices(tx, records)) unique.get(week.playerId)!.week = week;
  return { counts, players: [...unique.values()] };
}

async function sharedPlayer(tx: Transaction, viewerId: string, playerId: string) {
  const mine = alias(memberships, 'viewer_memberships');
  const theirs = alias(memberships, 'shared_memberships');
  if (viewerId !== playerId) {
    const common = () =>
      tx
        .select({ groupId: mine.groupId })
        .from(mine)
        .innerJoin(theirs, eq(theirs.groupId, mine.groupId))
        .where(and(eq(mine.playerId, viewerId), eq(theirs.playerId, playerId)));
    const candidates = await common();
    await lockGroups(
      tx,
      candidates.map((row) => row.groupId),
    );
    // A target may have left while we waited for a group's lock.
    const current = await common();
    const locked = new Set(candidates.map((row) => row.groupId));
    if (!current.some((row) => locked.has(row.groupId)))
      throw new ApiError(
        404,
        'PLAYER_UNAVAILABLE',
        'You no longer share a group with this player.',
      );
  }
  const [player] = await tx.select().from(players).where(eq(players.id, playerId));
  if (!player)
    throw new ApiError(404, 'PLAYER_UNAVAILABLE', 'This player is no longer available to you.');
  return player;
}

export function registerGroupRoutes(app: Hono<AppEnvironment>): void {
  app.get('/api/groups', async (c) => {
    const weekStart = parseWeekStart(c.req.query('weekStart') ?? '');
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const memberOf = await tx
        .select({ groupId: memberships.groupId })
        .from(memberships)
        .where(eq(memberships.playerId, session.player.id));
      const records = await lockGroups(
        tx,
        memberOf.map((row) => row.groupId),
      );
      const compared = await comparison(
        tx,
        records.map((row) => row.id),
        weekStart,
      );
      return {
        groups: records.map((group) => summary(group, compared.counts.get(group.id) ?? 0)),
        players: compared.players,
      };
    });
    return c.json(result);
  });

  app.post('/api/groups', async (c) => {
    const input = await readJson(c, createInput);
    const group = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [created] = await tx
          .insert(groups)
          .values({ name: input.name, shareCode: formatCode(randomCode(12)) })
          .onConflictDoNothing({ target: groups.shareCode })
          .returning();
        if (!created) continue;
        await tx.insert(memberships).values({ groupId: created.id, playerId: session.player.id });
        return summary(created, 1);
      }
      throw new ApiError(503, 'TRY_AGAIN', 'Please try creating the group again.');
    });
    return c.json({ group }, 201);
  });

  app.post('/api/groups/join', async (c) => {
    const input = await readJson(c, joinInput);
    const group = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const [record] = await tx
        .select()
        .from(groups)
        .where(eq(groups.shareCode, formatCode(input.code)))
        .for('update');
      if (!record)
        throw new ApiError(
          404,
          'GROUP_UNAVAILABLE',
          'This group code is not available. Check the code and try again.',
        );
      const total = await memberCount(tx, record.id);
      if (await isMember(tx, record.id, session.player.id)) return summary(record, total);
      if (total >= GROUP_CAPACITY)
        throw new ApiError(
          409,
          'GROUP_FULL',
          `This group is full. A group can have up to ${GROUP_CAPACITY} players.`,
        );
      await tx.insert(memberships).values({ groupId: record.id, playerId: session.player.id });
      return summary(record, total + 1);
    });
    return c.json({ group });
  });

  app.get('/api/groups/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const weekStart = parseWeekStart(c.req.query('weekStart') ?? '');
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const [group] = await lockGroups(tx, [id]);
      if (!group || !(await isMember(tx, id, session.player.id))) throw unavailable();
      const compared = await comparison(tx, [id], weekStart);
      return { group: summary(group, compared.players.length), members: compared.players };
    });
    return c.json(result);
  });

  app.delete('/api/groups/:id/membership', async (c) => {
    const id = parseId(c.req.param('id'));
    await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const [group] = await tx.select().from(groups).where(eq(groups.id, id)).for('update');
      if (!group) return;
      const removed = await tx
        .delete(memberships)
        .where(and(eq(memberships.groupId, id), eq(memberships.playerId, session.player.id)))
        .returning({ playerId: memberships.playerId });
      if (removed.length && (await memberCount(tx, id)) === 0)
        await tx.delete(groups).where(eq(groups.id, id));
    });
    return c.json({ ok: true });
  });

  app.get('/api/players/:playerId/weeks/:weekStart', async (c) => {
    const playerId = parseId(c.req.param('playerId'));
    const weekStart = parseWeekStart(c.req.param('weekStart'));
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const player = await sharedPlayer(tx, session.player.id, playerId);
      return { player, week: await readWeek(tx, playerId, weekStart) };
    });
    return c.json(result);
  });

  app.get('/api/players/:playerId/weeks', async (c) => {
    const playerId = parseId(c.req.param('playerId'));
    const parsed = historyInput.safeParse(c.req.query());
    if (!parsed.success)
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid history date and limit.');
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const player = await sharedPlayer(tx, session.player.id, playerId);
      return {
        player,
        ...(await readHistory(tx, playerId, parsed.data.before, parsed.data.limit)),
      };
    });
    return c.json(result);
  });
}
