import { Dexie, type Table } from 'dexie';
import type { WeekMutation, WeekRecord } from '../../shared/week';
import { identityNamespace } from './api-config';

export interface LocalWeek {
  key: string;
  owner: string;
  weekStart: string;
  data: WeekRecord;
  hydrated: boolean;
  version: number;
  dirty: boolean;
  fields: ('purchasePrice' | 'firstBuy' | 'previousPattern')[];
  slots: number[];
  pending?: WeekMutation & { version: number };
  conflict?: WeekRecord;
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
