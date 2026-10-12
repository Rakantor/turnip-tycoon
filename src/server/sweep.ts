import { inArray, lte, sql } from 'drizzle-orm';
import { connectDatabase, transaction, type Database } from '../db/connection';
import { friendInvites, pairingChallenges } from '../db/schema';

/** Rows removed per statement, so a backlog never holds one long transaction. */
const BATCH = 1000;
/** Statements per table and run; anything beyond waits for the next run. */
const BATCHES_PER_RUN = 50;

export interface SweepReport {
  pairingChallenges: number;
  friendInvites: number;
}

/** Deletes rows past `expiresAt` in bounded batches and returns how many went. */
async function deleteExpired(
  db: Database,
  table: typeof pairingChallenges | typeof friendInvites,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < BATCHES_PER_RUN; batch += 1) {
    const rows = await transaction(db, async (tx) => {
      const expired = tx
        .select({ id: table.id })
        .from(table)
        .where(lte(table.expiresAt, sql`clock_timestamp()`))
        .limit(BATCH);
      return tx.delete(table).where(inArray(table.id, expired)).returning({ id: table.id });
    });
    deleted += rows.length;
    if (rows.length < BATCH) break;
  }
  return deleted;
}

/**
 * Removes what the API no longer reads: pairing codes ten minutes after they were issued and
 * shared friend links seven days after they were made. Both only ever matched while unexpired.
 */
export async function sweepExpired(db: Database): Promise<SweepReport> {
  return {
    pairingChallenges: await deleteExpired(db, pairingChallenges),
    friendInvites: await deleteExpired(db, friendInvites),
  };
}

/** One scheduled run against the production database. */
export async function sweep(databaseUrl: string): Promise<SweepReport> {
  const { client, db } = await connectDatabase(databaseUrl);
  try {
    return await sweepExpired(db);
  } finally {
    await client.end();
  }
}
