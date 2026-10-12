import { and, asc, eq, gt, inArray, lte, not, or, sql, type SQL } from 'drizzle-orm';
import { connectDatabase, transaction, type Database, type Transaction } from '../db/connection';
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
 * Profiles handled per run at most, each deletion in a transaction of its own. Profile creation
 * admits 60 a minute, so an hourly run has to manage well over 3,600 to outpace a flood.
 */
const PLAYERS_PER_RUN = 5000;
/** Players examined per statement, by primary key: a bounded query whatever the table's size. */
const SCAN_PAGE = 10_000;
/** Wall time a run gets, shared by its phases; a cron trigger has 15 minutes in all. */
const RUN_BUDGET_MS = 10 * 60 * 1000;
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
  /** Deletions, or pages of the scan, that failed; a later run tries them again. */
  failures: number;
}

export interface SweepOptions {
  /** When to stop handling profiles and leave the rest for the next run. */
  deadline?: number;
  /** The player id the scan starts after; a run starts at random, so no profile is always last. */
  start?: string;
  /** Players examined per statement. */
  pageSize?: number;
}

/** Logs a failure by its name alone, as requests do: never SQL parameters or credentials. */
function logFailure(event: string, error: unknown): void {
  console.error(JSON.stringify({ event, name: error instanceof Error ? error.name : 'unknown' }));
}

/** Deletes rows past `expiresAt` in bounded batches until the deadline, returning how many went. */
async function deleteExpired(
  db: Database,
  table: typeof pairingChallenges | typeof friendInvites,
  deadline: number,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < BATCHES_PER_RUN && Date.now() < deadline; batch += 1) {
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
  deadline = Date.now() + RUN_BUDGET_MS,
): Promise<Pick<SweepReport, 'pairingChallenges' | 'friendInvites'>> {
  return {
    pairingChallenges: await deleteExpired(db, pairingChallenges, deadline),
    friendInvites: await deleteExpired(db, friendInvites, deadline),
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
 * One page of the scan: the players with ids in (`after`, `upTo`], at most `size` of them, as
 * the id the next page starts after, null once the range is used up, and the abandoned ones
 * among them, up to `limit`. Both statements walk one page of the primary key, so each stays
 * small however many players there are.
 */
async function scanPage(
  tx: Transaction,
  after: string | null,
  upTo: string | null,
  size: number,
  limit: number,
): Promise<{ end: string | null; candidates: string[] }> {
  const within = (end: string | null) =>
    and(
      after === null ? undefined : gt(players.id, after),
      end === null ? undefined : lte(players.id, end),
    );
  const [edge] = await tx
    .select({ id: players.id })
    .from(players)
    .where(within(upTo))
    .orderBy(asc(players.id))
    .offset(size - 1)
    .limit(1);
  const rows = await tx
    .select({ id: players.id })
    .from(players)
    .where(and(within(edge ? edge.id : upTo), abandoned()))
    .orderBy(asc(players.id))
    .limit(limit);
  return { end: edge ? edge.id : null, candidates: rows.map((row) => row.id) };
}

/**
 * Deletes abandoned profiles one at a time, through the same path as a player's own request,
 * until the candidates, the run's cap or its time are used up. The scan walks the players by
 * id from a random start, round to it again, a bounded page at a time: no statement grows with
 * the table, and a profile behind one whose deletion keeps failing is reached by a later run.
 */
export async function sweepAbandoned(
  db: Database,
  {
    deadline = Date.now() + RUN_BUDGET_MS,
    start = crypto.randomUUID(),
    pageSize = SCAN_PAGE,
  }: SweepOptions = {},
): Promise<Pick<SweepReport, 'players' | 'failures'>> {
  const report = { players: 0, failures: 0 };
  let handled = 0;
  let streak = 0;
  const withinBudget = () => handled < PLAYERS_PER_RUN && Date.now() < deadline;

  /** Deletes one candidate unless a request holds it; false once failures end the run. */
  const remove = async (id: string): Promise<boolean> => {
    handled += 1;
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
      return true;
    } catch (error) {
      // One profile's failure, such as a group lock held past lock_timeout, stops nothing else.
      report.failures += 1;
      logFailure('sweep_player_failed', error);
      streak += 1;
      return streak < FAILURE_STREAK;
    }
  };

  /** Works through the players with ids in (`after`, `upTo`]; false once the run is over. */
  const scan = async (after: string | null, upTo: string | null): Promise<boolean> => {
    while (withinBudget()) {
      let page: Awaited<ReturnType<typeof scanPage>>;
      try {
        page = await transaction(db, (tx) =>
          scanPage(tx, after, upTo, pageSize, PLAYERS_PER_RUN - handled),
        );
      } catch (error) {
        report.failures += 1;
        logFailure('sweep_scan_failed', error);
        return false;
      }
      for (const id of page.candidates) if (!withinBudget() || !(await remove(id))) return false;
      if (page.end === null) return true;
      after = page.end;
    }
    return false;
  };
  if (await scan(start, null)) await scan(null, start);
  return report;
}

/** One scheduled run against the production database, within one budget for both phases. */
export async function sweep(databaseUrl: string): Promise<SweepReport> {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const { client, db } = await connectDatabase(databaseUrl);
  try {
    return { ...(await sweepExpired(db, deadline)), ...(await sweepAbandoned(db, { deadline })) };
  } finally {
    await client.end();
  }
}
