import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { database } from '../../src/client/data/database';
import { activeIdentity, resumeWeeks, weekStore } from '../../src/client/data/runtime';
import { weekKey } from '../../src/client/data/sync';
import { emptyWeek, type WeekMutation, type WeekRecord } from '../../src/shared/week';

afterEach(async () => {
  vi.restoreAllMocks();
  activeIdentity.owner = null;
  activeIdentity.connected = false;
  await database.delete();
});

it('resumes older and current offline weeks after confirmation without sending another profile’s edits', async () => {
  const owner = 'reopened-player';
  const previous = '2026-10-04';
  const current = '2026-10-11';
  const remote = new Map<string, WeekRecord>();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input);
    const weekStart = path.substring(path.lastIndexOf('/') + 1);
    const row = remote.get(weekStart) ?? emptyWeek(owner, weekStart);
    if (options?.method === 'PUT') {
      const mutation = JSON.parse(String(options.body)) as WeekMutation;
      expect(mutation.baseRevision).toBe(row.revision);
      const updated = {
        ...row,
        purchasePrice: mutation.purchasePrice,
        prices: mutation.prices,
        revision: row.revision + 1,
      };
      remote.set(weekStart, updated);
      return Response.json({ revision: updated.revision });
    }
    return Response.json({ week: row });
  });
  await weekStore.edit(owner, previous, { purchasePrice: 100 });
  await weekStore.edit(owner, current, { purchasePrice: 95 });
  await weekStore.edit('another-player', current, { purchasePrice: 110 });
  database.close();
  await database.open();

  // Restoring cached identity makes prices available, but grants no API access.
  activeIdentity.owner = owner;
  activeIdentity.connected = false;
  await resumeWeeks(owner);
  expect(fetch).not.toHaveBeenCalled();
  expect((await database.weeks.get(weekKey(owner, previous)))?.dirty).toBe(true);

  // Session confirmation triggers the runtime hook for every queued week.
  activeIdentity.connected = true;
  await resumeWeeks(owner);
  expect(remote.get(previous)?.purchasePrice).toBe(100);
  expect(remote.get(current)?.purchasePrice).toBe(95);
  expect((await database.weeks.get(weekKey(owner, previous)))?.dirty).toBe(false);
  expect((await database.weeks.get(weekKey(owner, current)))?.dirty).toBe(false);
  expect((await database.weeks.get(weekKey('another-player', current)))?.dirty).toBe(true);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(2);
});
