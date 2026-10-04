import { request } from './api';
import { database } from './database';
import { WeekStore } from './sync';
import type { WeekRecord } from '../../shared/week';

export const activeIdentity: { owner: string | null; connected: boolean } = {
  owner: null,
  connected: false,
};
export const weekStore = new WeekStore(database, {
  get: async (weekStart) => (await request<{ week: WeekRecord }>(`/weeks/${weekStart}`)).week,
  put: (weekStart, body) => request(`/weeks/${weekStart}`, { method: 'PUT', body }),
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
