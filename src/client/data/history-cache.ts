import { shiftWeek } from '../../shared/calendar';
import { totalsOf } from '../../shared/ledger';
import type { OwnWeekRecord } from '../../shared/week';
import { type LocalWeek, ownWeek, type StoredWeek, type TurnipDatabase } from './database';
import { writeForProfile } from './profile-storage';
import { mergeTouched } from './sync';

/** One page of `GET /api/weeks`, newest first; the cursor is the oldest week on it. */
export interface HistoryPage {
  weeks: StoredWeek[];
  nextCursor: string | null;
}

export interface HistoryTransport {
  /** The saved weeks that start before `before`. */
  get(before: string): Promise<HistoryPage>;
  isActive(owner: string): boolean;
}

const keyFor = (owner: string) => `history:${owner}`;

/** The weeks History last showed per profile, so the list reads offline. */
export class HistoryCache {
  constructor(
    private db: TurnipDatabase,
    private transport: HistoryTransport,
  ) {}

  async read(owner: string): Promise<HistoryPage | null> {
    const value = (await this.db.meta.get(keyFor(owner)))?.value as
      Partial<HistoryPage> | undefined;
    if (
      !value ||
      !Array.isArray(value.weeks) ||
      !(typeof value.nextCursor === 'string' || value.nextCursor === null)
    )
      return null;
    return { weeks: value.weeks, nextCursor: value.nextCursor };
  }

  /** The newest page, this week included. Null if the profile changed while it loaded. */
  first(owner: string, currentWeek: string): Promise<HistoryPage | null> {
    return this.fetch(owner, shiftWeek(currentWeek, 1));
  }

  /** The list with its next older page after it. */
  async more(owner: string, list: HistoryPage): Promise<HistoryPage | null> {
    if (!list.nextCursor) return list;
    const page = await this.fetch(owner, list.nextCursor);
    if (!page) return null;
    const known = new Set(list.weeks.map((week) => week.weekStart));
    return {
      weeks: [...list.weeks, ...page.weeks.filter((week) => !known.has(week.weekStart))],
      nextCursor: page.nextCursor,
    };
  }

  /** Keeps the list as History shows it, replacing the one saved before. */
  async save(owner: string, list: HistoryPage): Promise<void> {
    await writeForProfile(this.db, owner, [], async () => {
      await this.db.meta.put({ key: keyFor(owner), value: list });
    });
  }

  private async fetch(owner: string, before: string): Promise<HistoryPage | null> {
    if (!this.transport.isActive(owner)) return null;
    const page = await this.transport.get(before);
    // The response belongs to whoever was signed in when it was requested.
    return this.transport.isActive(owner) ? page : null;
  }
}

/**
 * The saved list with this device's newer copies in place of its weeks, newest first.
 * This week shows once a sale gives it a result; weeks ahead of the clock wait for it.
 */
export function withLocalHistory(
  saved: HistoryPage | null,
  rows: readonly LocalWeek[],
  currentWeek: string,
): OwnWeekRecord[] {
  const byWeek = new Map((saved?.weeks ?? []).map((week) => [week.weekStart, week]));
  for (const row of rows) {
    if (row.conflict) continue;
    const cached = byWeek.get(row.weekStart);
    if (cached) {
      if (row.dirty) byWeek.set(row.weekStart, row.hydrated ? row.data : mergeTouched(cached, row));
      // Every save raises the revision, so a higher one is a later read of the server.
      else if (row.hydrated && row.data.revision > cached.revision)
        byWeek.set(row.weekStart, row.data);
    } else if (
      // Saved since the list loaded, within the weeks it covers; anything older would leave gaps.
      (saved ? row.weekStart > (saved.nextCursor ?? '') : row.weekStart === currentWeek) &&
      (row.dirty || row.data.revision > 0)
    )
      byWeek.set(row.weekStart, row.data);
  }
  return [...byWeek.values()]
    .map(ownWeek)
    .filter(
      (week) =>
        week.weekStart < currentWeek ||
        (week.weekStart === currentWeek && totalsOf(week.trades).sold > 0),
    )
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart));
}
