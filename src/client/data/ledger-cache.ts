import { totalsOf, type LedgerResponse, type LedgerWeek } from '../../shared/ledger';
import { type LocalWeek, ownWeek, type TurnipDatabase } from './database';
import { writeForProfile } from './profile-storage';

export interface SavedLedger {
  weeks: LedgerWeek[];
  /** When the request started: weeks synced since then count from this device. */
  fetchedAt: number;
}

export interface LedgerTransport {
  get(): Promise<LedgerResponse>;
  isActive(owner: string): boolean;
}

const keyFor = (owner: string) => `ledger:${owner}`;

/** The latest `GET /api/ledger` per profile, so overall profit reads offline. */
export class LedgerCache {
  constructor(
    private db: TurnipDatabase,
    private transport: LedgerTransport,
  ) {}

  async read(owner: string): Promise<SavedLedger | null> {
    const value = (await this.db.meta.get(keyFor(owner)))?.value as
      Partial<SavedLedger> | undefined;
    if (!value || !Array.isArray(value.weeks) || typeof value.fetchedAt !== 'number') return null;
    return { weeks: value.weeks, fetchedAt: value.fetchedAt };
  }

  /** Reads the server at most once a minute. A read stamped in the future means the clock moved back. */
  async refresh(owner: string): Promise<void> {
    const saved = await this.read(owner);
    const now = Date.now();
    if (saved && saved.fetchedAt <= now && now < saved.fetchedAt + 60_000) return;
    if (!this.transport.isActive(owner)) return;
    const { weeks } = await this.transport.get();
    // The response belongs to whoever was signed in when it was requested.
    if (!this.transport.isActive(owner)) return;
    await writeForProfile(this.db, owner, [], async () => {
      await this.db.meta.put({ key: keyFor(owner), value: { weeks, fetchedAt: now } });
    });
  }
}

/**
 * The server's weeks, with this device's newer trades in place of its rows: unsent
 * trade edits, and weeks synced after the ledger was fetched. Newest week first.
 */
export function withLocalWeeks(
  saved: SavedLedger | null,
  rows: readonly LocalWeek[],
): LedgerWeek[] {
  const byWeek = new Map((saved?.weeks ?? []).map((week) => [week.weekStart, week]));
  for (const row of rows) {
    const newer =
      row.fields.includes('trades') ||
      (row.data.trades !== undefined &&
        row.syncedAt !== undefined &&
        (!saved || row.syncedAt >= saved.fetchedAt));
    if (!newer) continue;
    const { trades } = ownWeek(row.data);
    if (trades.length) byWeek.set(row.weekStart, { weekStart: row.weekStart, ...totalsOf(trades) });
    else byWeek.delete(row.weekStart);
  }
  return [...byWeek.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart));
}
