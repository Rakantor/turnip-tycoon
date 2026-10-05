import { desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Hono } from 'hono';
import { trades, weeks } from '../db/schema';
import type { LedgerResponse } from '../shared/ledger';
import type { AppEnvironment } from './app';
import { sessionHash, withSession } from './auth';

// PostgreSQL sums integers as bigint, which the driver returns as text.
function total(amount: SQL | typeof trades.quantity, kind: 'buy' | 'sell') {
  return sql<number>`coalesce(sum(${amount}) filter (where ${trades.kind} = ${kind}), 0)`.mapWith(
    Number,
  );
}

export function registerLedgerRoutes(app: Hono<AppEnvironment>): void {
  // One row per own week with trades, newest first. This is never shared.
  app.get('/api/ledger', async (c) => {
    const bells = sql`${trades.quantity} * ${trades.price}`;
    const result: LedgerResponse = await withSession(
      c.get('db'),
      await sessionHash(c),
      async (tx, session) => ({
        weeks: await tx
          .select({
            weekStart: weeks.weekStart,
            bought: total(trades.quantity, 'buy'),
            spent: total(bells, 'buy'),
            sold: total(trades.quantity, 'sell'),
            earned: total(bells, 'sell'),
          })
          .from(trades)
          .innerJoin(weeks, eq(weeks.id, trades.weekId))
          .where(eq(trades.playerId, session.player.id))
          .groupBy(weeks.weekStart)
          .orderBy(desc(weeks.weekStart)),
      }),
    );
    return c.json(result);
  });
}
