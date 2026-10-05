import type { LedgerResponse } from '../../shared/ledger';
import { request } from './api';
import { database, type StoredWeek } from './database';
import { LedgerCache } from './ledger-cache';
import { WeekStore } from './sync';

export const activeIdentity: { owner: string | null; connected: boolean } = {
  owner: null,
  connected: false,
};
export const weekStore = new WeekStore(database, {
  get: async (weekStart) => (await request<{ week: StoredWeek }>(`/weeks/${weekStart}`)).week,
  put: (weekStart, body) => request(`/weeks/${weekStart}`, { method: 'PUT', body }),
  isActive: (owner) => activeIdentity.connected && activeIdentity.owner === owner,
});

export const ledgerCache = new LedgerCache(database, {
  get: () => request<LedgerResponse>('/ledger'),
  isActive: (owner) => activeIdentity.connected && activeIdentity.owner === owner,
});

export async function resumeWeeks(owner: string): Promise<void> {
  const rows = await database.weeks.where('owner').equals(owner).toArray();
  // Include past weeks: crossing Sunday must not strand pending edits.
  for (const row of rows)
    if (row.dirty && !row.conflict) {
      try {
        await weekStore.sync(owner, row.weekStart);
      } catch {
        /* Retain the queued mutation for retry. */
      }
    }
}
