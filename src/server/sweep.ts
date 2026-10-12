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
import { RENEWAL_SECONDS, SESSION_SECONDS } from './http';
import { deletePlayer } from './profile-data';

/** Rows removed per statement, so a backlog never holds one long transaction. */
const BATCH = 1000;
/** Statements per table and run; anything beyond waits for the next run. */
const BATCHES_PER_RUN = 50;
/**
 * Profiles deleted per run at most, each in a transaction of its own. Profile creation admits
 * 60 a minute, so an hourly run has to manage well over 3,600 to outpace a flood.
 */
const PLAYERS_PER_RUN = 5000;
/** Wall time a run spends on profiles; a cron trigger gets 15 minutes in all. */
const PLAYERS_BUDGET_MS = 10 * 60 * 1000;
/** Failures in a row that end a run: the database itself, not one profile, is the problem. */
const FAILURE_STREAK = 5;

/**
 * Without a recovery code, a profile whose every device access has expired can never be opened
 * again, since pairing needs a connected device to approve it. It is deleted this long after
 * the last access expired: a session window plus this after the app was last used online.
 */
export const ABANDONED_AFTER_DAYS = 30;
/** With a recovery code the profile can still be opened, so it waits this long instead. */
export const RECOVERABLE_RETENTION_DAYS = 365;

export interface SweepReport {
  pairingChallenges: number;
  friendInvites: number;
  /** Profiles deleted. */
  players: number;
  /** Profiles whose deletion failed; a later run tries them again. */
  failures: number;
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
/** Whether the player has a device meeting `condition`. */
const device = (condition: SQL) =>
  sql`exists (select 1 from ${devices} where ${devices.playerId} = ${players.id} and ${condition})`;
/**
 * The sweep judges a profile by its devices. One without any, which only removing or logging
 * out of the last device leaves behind, gives it nothing to go on, so that profile stays.
 */
const hasDevices = device(sql`true`);
/** A device that can still use the profile. */
const live = device(sql`${devices.expiresAt} > clock_timestamp()`);
/** A device whose access is live, or expired less than this many days ago. */
const reachableWithin = (days: number) =>
  device(sql`${devices.expiresAt} > clock_timestamp() - ${days} * interval '1 day'`);
// A device starts with a session window of access, and use renews it no sooner than a renewal
// interval later, so only a renewed device's expiry lies this far past its creation.
const renewed = device(
  sql`${devices.expiresAt} >= ${devices.createdAt} + ${SESSION_SECONDS + RENEWAL_SECONDS / 2} * interval '1 second'`,
);
const holdsAnything = or(
  sql`exists (select 1 from ${weeks} where ${weeks.playerId} = ${players.id})`,
  sql`exists (select 1 from ${memberships} where ${memberships.playerId} = ${players.id})`,
  sql`exists (select 1 from ${friendLinks} where ${friendLinks.playerId} = ${players.id} or ${friendLinks.friendId} = ${players.id})`,
  sql`exists (select 1 from ${friendInvites} where ${friendInvites.playerId} = ${players.id})`,
)!;

/**
 * Which players the sweep may delete; checked again under the player's lock before deleting.
 * A profile is never deleted while a device can still use it: that device may hold edits it
 * has not sent yet, and would clear them on learning that the profile is gone.
 */
function abandoned(): SQL {
  return and(
    hasDevices,
    or(
      and(not(recoverable), not(reachableWithin(ABANDONED_AFTER_DAYS))),
      and(recoverable, not(reachableWithin(RECOVERABLE_RETENTION_DAYS))),
      // Started but never used again: nothing saved, and no device renewed after its first day.
      and(not(recoverable), not(live), not(renewed), not(holdsAnything)),
    ),
  )!;
}

/**
 * Deletes abandoned profiles one at a time, through the same path as a player's own request,
 * until the candidates, the run's cap or its time are used up.
 */
export async function sweepAbandoned(
  db: Database,
  deadline = Date.now() + PLAYERS_BUDGET_MS,
): Promise<Pick<SweepReport, 'players' | 'failures'>> {
  const candidates = await db
    .select({ id: players.id })
    .from(players)
    .where(abandoned())
    .limit(PLAYERS_PER_RUN);
  const report = { players: 0, failures: 0 };
  let streak = 0;
  for (const { id } of candidates) {
    if (Date.now() >= deadline) break;
    try {
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
      if (gone) report.players += 1;
      streak = 0;
    } catch (error) {
      // One profile's failure, such as a group lock held past lock_timeout, stops nothing
      // else. As for requests, keep only the error's name.
      report.failures += 1;
      console.error(
        JSON.stringify({
          event: 'sweep_player_failed',
          name: error instanceof Error ? error.name : 'unknown',
        }),
      );
      streak += 1;
      if (streak >= FAILURE_STREAK) break;
    }
  }
  return report;
}

/** One scheduled run against the production database. */
export async function sweep(databaseUrl: string): Promise<SweepReport> {
  const { client, db } = await connectDatabase(databaseUrl);
  try {
    return { ...(await sweepExpired(db)), ...(await sweepAbandoned(db)) };
  } finally {
    await client.end();
  }
}
