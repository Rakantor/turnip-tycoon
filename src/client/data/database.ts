import { Dexie, type Table } from 'dexie';
import type { Trade } from '../../shared/ledger';
import type { OwnWeekRecord, WeekMutation, WeekRecord } from '../../shared/week';
import { identityNamespace } from './api-config';

/** Weeks this device saved before trades existed have none: read them as an empty list. */
export type StoredWeek = WeekRecord & { trades?: Trade[] };

export function ownWeek(week: StoredWeek): OwnWeekRecord {
  return week.trades ? { ...week, trades: week.trades } : { ...week, trades: [] };
}

export interface LocalWeek {
  key: string;
  owner: string;
  weekStart: string;
  data: StoredWeek;
  hydrated: boolean;
  version: number;
  dirty: boolean;
  fields: ('purchasePrice' | 'firstBuy' | 'previousPattern' | 'trades')[];
  slots: number[];
  pending?: WeekMutation & { version: number };
  conflict?: StoredWeek;
  /** The server version this device's unsent edits started from, to combine other devices' edits. */
  base?: StoredWeek;
  /** When this week last matched the server, so a ledger fetched earlier counts it from here. */
  syncedAt?: number;
}

export class TurnipDatabase extends Dexie {
  weeks!: Table<LocalWeek, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  constructor(name = 'turnips') {
    super(name);
    this.version(1).stores({ weeks: 'key,owner,weekStart', meta: 'key' });
  }
}
export const database = new TurnipDatabase(identityNamespace);
