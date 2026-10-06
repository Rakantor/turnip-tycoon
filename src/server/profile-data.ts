import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Transaction } from '../db/connection';
import {
  devices,
  groups,
  memberships,
  mutations,
  pairingChallenges,
  players,
  priceEntries,
  trades,
  weeks,
} from '../db/schema';
import {
  EXPORT_SECTIONS,
  type ExportSection,
  type ProfileExportPage,
} from '../shared/profile-data';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import { readJson, writeCredential } from './http';

const PAGE_SIZE = 100;
const exportInput = z
  .object({ section: z.enum(EXPORT_SECTIONS), after: z.string().uuid().optional() })
  .strict();
const deleteInput = z
  .object({ playerId: z.string().uuid(), confirm: z.literal('delete') })
  .strict();

async function readPage(tx: Transaction, owner: string, section: ExportSection, after?: string) {
  // Explicit credential projections: neither secrets nor their verifiers belong in a download.
  switch (section) {
    case 'devices':
      return tx
        .select({
          id: devices.id,
          name: devices.name,
          createdAt: devices.createdAt,
          expiresAt: devices.expiresAt,
        })
        .from(devices)
        .where(and(eq(devices.playerId, owner), after ? gt(devices.id, after) : undefined))
        .orderBy(asc(devices.id))
        .limit(PAGE_SIZE + 1);
    case 'groups':
      return tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .innerJoin(memberships, eq(groups.id, memberships.groupId))
        .where(and(eq(memberships.playerId, owner), after ? gt(groups.id, after) : undefined))
        .orderBy(asc(groups.id))
        .limit(PAGE_SIZE + 1);
    case 'pairing':
      return tx
        .select({
          id: pairingChallenges.id,
          deviceName: pairingChallenges.deviceName,
          approvedByDeviceId: pairingChallenges.approvedByDeviceId,
          expiresAt: pairingChallenges.expiresAt,
        })
        .from(pairingChallenges)
        .where(
          and(
            eq(pairingChallenges.playerId, owner),
            after ? gt(pairingChallenges.id, after) : undefined,
          ),
        )
        .orderBy(asc(pairingChallenges.id))
        .limit(PAGE_SIZE + 1);
    case 'syncRecords':
      return tx
        .select({
          id: mutations.mutationId,
          payloadHash: mutations.payloadHash,
          resultingRevision: mutations.resultingRevision,
        })
        .from(mutations)
        .where(
          and(eq(mutations.playerId, owner), after ? gt(mutations.mutationId, after) : undefined),
        )
        .orderBy(asc(mutations.mutationId))
        .limit(PAGE_SIZE + 1);
    case 'weeks': {
      const rows = await tx
        .select()
        .from(weeks)
        .where(and(eq(weeks.playerId, owner), after ? gt(weeks.id, after) : undefined))
        .orderBy(asc(weeks.id))
        .limit(PAGE_SIZE + 1);
      const ids = rows.slice(0, PAGE_SIZE).map((row) => row.id);
      if (!ids.length) return [];
      const prices = await tx
        .select()
        .from(priceEntries)
        .where(and(eq(priceEntries.playerId, owner), inArray(priceEntries.weekId, ids)))
        .orderBy(asc(priceEntries.day), asc(priceEntries.slot));
      const entries = await tx
        .select()
        .from(trades)
        .where(and(eq(trades.playerId, owner), inArray(trades.weekId, ids)))
        .orderBy(asc(trades.position));
      return rows.map((week) => ({
        ...week,
        prices: prices.filter((entry) => entry.weekId === week.id),
        trades: entries.filter((entry) => entry.weekId === week.id),
      }));
    }
  }
}

export function registerProfileDataRoutes(app: Hono<AppEnvironment>): void {
  app.get('/api/profile/export', async (c) => {
    const input = exportInput.safeParse(c.req.query());
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid export page.');
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const rows = await readPage(tx, session.player.id, input.data.section, input.data.after);
      return {
        profile: session.player,
        hasRecoveryCode: session.hasRecoveryCode,
        section: input.data.section,
        records: rows.slice(0, PAGE_SIZE),
        nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null,
      } satisfies ProfileExportPage;
    });
    return c.json(result);
  });

  app.delete('/api/profile', async (c) => {
    const input = await readJson(c, deleteInput);
    const deletedPlayerId = await withSession(
      c.get('db'),
      await sessionHash(c),
      async (tx, session) => {
        if (session.player.id !== input.playerId)
          throw new ApiError(
            409,
            'PLAYER_CHANGED',
            'Your profile changed. Review it before deleting.',
          );
        const memberOf = await tx
          .select({ id: memberships.groupId })
          .from(memberships)
          .where(eq(memberships.playerId, session.player.id));
        const ids = memberOf.map((row) => row.id);
        // Match group admission/departure and shared-read locks, always in the same order.
        if (ids.length)
          await tx
            .select({ id: groups.id })
            .from(groups)
            .where(inArray(groups.id, ids))
            .orderBy(asc(groups.id))
            .for('update');
        // Foreign keys remove all owned weeks, prices, trades, devices, recovery,
        // approved pairing challenges, memberships, and mutation receipts atomically.
        await tx.delete(players).where(eq(players.id, session.player.id));
        if (ids.length)
          await tx
            .delete(groups)
            .where(
              and(
                inArray(groups.id, ids),
                sql`not exists (select 1 from ${memberships} where ${memberships.groupId} = ${groups.id})`,
              ),
            );
        return session.player.id;
      },
    );
    writeCredential(c, 'session', '');
    writeCredential(c, 'pairing', '');
    return c.json({ deletedPlayerId });
  });
}
