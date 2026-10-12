import { and, eq, inArray, lte, not, or, sql, type SQL } from 'drizzle-orm';
import { connectDatabase, transaction, type Database } from '../db/connection';
import {
  devices,
  friendInvites,
  friendLinks,
  memberships,
  pairingChallenges,
  players,
  recoveryCredentials,
  weeks,
} from '../db/schema';
import { deletePlayer } from './profile-data';

/** Rows removed per statement, so a backlog never holds one long transaction. */
const BATCH = 1000;
/** Statements per table and run; anything beyond waits for the next run. */
const BATCHES_PER_RUN = 50;
/** Profiles deleted per run, each in a transaction of its own. */
const PLAYERS_PER_RUN = 200;

/**
 * Without a recovery code, a profile whose every device access has expired can never be opened
 * again, since pairing needs a connected device to approve it. It is deleted this long after
 * the last access expired: 60 days after the app was last used online.
 */
export const ABANDONED_AFTER_DAYS = 30;
/** With a recovery code the profile can still be opened, so it waits this long instead. */
export const RECOVERABLE_RETENTION_DAYS = 365;
/** A profile holding nothing, never used again after its first day, is deleted this soon. */
export const UNUSED_AFTER_DAYS = 7;

export interface SweepReport {
  pairingChallenges: number;
  friendInvites: number;
  players: number;
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
export async function sweepExpired(
  db: Database,
): Promise<Pick<SweepReport, 'pairingChallenges' | 'friendInvites'>> {
  return {
    pairingChallenges: await deleteExpired(db, pairingChallenges),
    friendInvites: await deleteExpired(db, friendInvites),
  };
}

const recoverable = sql`exists (select 1 from ${recoveryCredentials} where ${recoveryCredentials.playerId} = ${players.id})`;
/** A device whose access is live, or expired less than this many days ago. */
const reachableWithin = (days: number) =>
  sql`exists (select 1 from ${devices} where ${devices.playerId} = ${players.id} and ${devices.expiresAt} > clock_timestamp() - ${days} * interval '1 day')`;
// A device starts with 30 days of access, and renewal happens a day or more later, so only a
// renewed device's expiry lies this far past its creation.
const RENEWED = sql`interval '30 days 12 hours'`;
/** A device added lately, or one renewed by use after its first day. */
const usedLately = sql`exists (select 1 from ${devices} where ${devices.playerId} = ${players.id} and (${devices.createdAt} > clock_timestamp() - ${UNUSED_AFTER_DAYS} * interval '1 day' or ${devices.expiresAt} >= ${devices.createdAt} + ${RENEWED}))`;
const holdsAnything = or(
  sql`exists (select 1 from ${weeks} where ${weeks.playerId} = ${players.id})`,
  sql`exists (select 1 from ${memberships} where ${memberships.playerId} = ${players.id})`,
  sql`exists (select 1 from ${friendLinks} where ${friendLinks.playerId} = ${players.id} or ${friendLinks.friendId} = ${players.id})`,
  sql`exists (select 1 from ${friendInvites} where ${friendInvites.playerId} = ${players.id})`,
)!;

/** Which players the sweep may delete; checked again under the player's lock before deleting. */
function abandoned(): SQL {
  return or(
    and(not(recoverable), not(reachableWithin(ABANDONED_AFTER_DAYS))),
    and(recoverable, not(reachableWithin(RECOVERABLE_RETENTION_DAYS))),
    and(not(recoverable), not(holdsAnything), not(usedLately)),
  )!;
}

/** Deletes abandoned profiles one at a time, through the same path as a player's own request. */
export async function sweepAbandoned(db: Database): Promise<number> {
  const candidates = await db
    .select({ id: players.id })
    .from(players)
    .where(abandoned())
    .limit(PLAYERS_PER_RUN);
  let deleted = 0;
  for (const { id } of candidates) {
    const gone = await transaction(db, async (tx) => {
      // A request holding the player is using the profile: leave it for a later run.
      const [player] = await tx
        .select({ id: players.id })
        .from(players)
        .where(and(eq(players.id, id), abandoned()))
        .for('no key update', { skipLocked: true });
      if (!player) return false;
      await deletePlayer(tx, id);
      return true;
    });
    if (gone) deleted += 1;
  }
  return deleted;
}

/** One scheduled run against the production database. */
export async function sweep(databaseUrl: string): Promise<SweepReport> {
  const { client, db } = await connectDatabase(databaseUrl);
  try {
    return { ...(await sweepExpired(db)), players: await sweepAbandoned(db) };
  } finally {
    await client.end();
  }
}
