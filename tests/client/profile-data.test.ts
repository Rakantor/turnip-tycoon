import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnipDatabase } from '../../src/client/data/database';
import { SessionVault } from '../../src/client/data/session-vault';
import { WeekStore, weekKey } from '../../src/client/data/sync';
import { blockedProfileKey, ProfileWriteBlockedError } from '../../src/client/data/profile-storage';
import { collectProfileExport } from '../../src/client/data/profile-export';
import { SharedGroupsCache } from '../../src/client/data/shared-groups';
import { LedgerCache } from '../../src/client/data/ledger-cache';
import { PendingEdits } from '../../src/client/data/pending-edits';
import { emptyOwnWeek } from '../../src/shared/week';
import type { ProfileExportPage } from '../../src/shared/profile-data';

const owner = 'one';
const week = '2026-10-04';
const profile = { id: owner, displayName: 'Maple', islandName: null, friendCode: 'MAPL-E123-4567' };
const databases: TurnipDatabase[] = [];
function harness() {
  const db = new TurnipDatabase(`profile-test-${crypto.randomUUID()}`);
  databases.push(db);
  const transport = {
    get: vi.fn(async () => emptyOwnWeek(owner, week)),
    put: vi.fn(async () => ({ revision: 1 })),
    isActive: () => true,
  };
  return { db, vault: new SessionVault(db, true), store: new WeekStore(db, transport), transport };
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('local profile cleanup', () => {
  it('retains another tab’s blocked edits until deletion is canceled and writes resume', async () => {
    const h = harness();
    const revision = await h.vault.save(
      { player: profile, deviceId: 'device', hasRecoveryCode: false },
      'a'.repeat(64),
      null,
      () => true,
    );
    const pending = new PendingEdits(async (id, start, patch, slots) => {
      await h.store.edit(id, start, patch, slots);
      return h.db.weeks.get(weekKey(id, start));
    });
    await pending.enqueue(owner, week, { purchasePrice: 100 });
    const removal = await h.vault.beginRemoval(owner, revision);
    await expect(pending.enqueue(owner, week, { purchasePrice: 110 })).rejects.toBeInstanceOf(
      ProfileWriteBlockedError,
    );
    await expect(pending.flushAll()).rejects.toBeInstanceOf(ProfileWriteBlockedError);
    expect(pending.snapshot(owner, week)).toMatchObject({
      edits: [{ patch: { purchasePrice: 110 } }],
      error: expect.any(String),
    });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.purchasePrice).toBe(100);
    await h.vault.cancelRemoval(owner, removal);
    await pending.flushAll();
    expect(pending.snapshot(owner, week)).toMatchObject({ edits: [], error: null });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.purchasePrice).toBe(110);
  });

  it('preserves another profile’s group snapshot when only device access is cleared', async () => {
    const h = harness();
    await h.vault.save(
      { player: profile, deviceId: 'device', hasRecoveryCode: false },
      'a'.repeat(64),
      null,
      () => true,
    );
    const data = { players: [{ player: profile }], groups: [], weekStart: week };
    await h.db.meta.put({ key: 'shared-groups:other', value: data });
    await h.vault.finishRemoval(owner, 'disconnected');
    expect((await h.db.meta.get('shared-groups:other'))?.value).toEqual(data);
  });

  it('removes owned records and drafts, retains unrelated profiles, and blocks stale writes', async () => {
    const h = harness();
    const revision = await h.vault.save(
      { player: profile, deviceId: 'device', hasRecoveryCode: false },
      'a'.repeat(64),
      null,
      () => true,
    );
    for (const id of [owner, 'other', 'unassigned'])
      await h.store.edit(id, week, { purchasePrice: 100 });
    await h.db.meta.bulkPut([
      { key: `ledger:${owner}`, value: { weeks: [] } },
      { key: `refresh:${owner}|${week}`, value: 1 },
      { key: 'ledger:other', value: { weeks: [] } },
      { key: 'shared-groups:other', value: { players: [{ player: profile }] } },
    ]);
    await h.vault.beginRemoval(owner, revision);
    await h.vault.finishRemoval(owner, 'deleted');
    expect((await h.db.weeks.toArray()).map((row) => row.owner)).toEqual(['other']);
    expect(await h.db.meta.get(`ledger:${owner}`)).toBeUndefined();
    expect(await h.db.meta.get(`refresh:${owner}|${week}`)).toBeUndefined();
    expect(await h.db.meta.get('shared-groups:other')).toBeUndefined();
    expect(await h.db.meta.get('ledger:other')).toBeDefined();
    expect(await h.vault.read()).toMatchObject({ session: null, token: null });
    await expect(h.store.edit(owner, week, { purchasePrice: 110 })).rejects.toBeInstanceOf(
      ProfileWriteBlockedError,
    );
    await h.store.initialize(owner, week);
    await h.store.attachDrafts(owner);
    await h.store.sync(owner, week);
    expect(await h.db.weeks.get(weekKey(owner, week))).toBeUndefined();
    expect(h.transport.put).not.toHaveBeenCalled();
  });

  it('discards an in-flight server read that arrives after deletion in another tab', async () => {
    const h = harness();
    let finish!: (value: ReturnType<typeof emptyOwnWeek>) => void;
    h.transport.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const sync = h.store.sync(owner, week);
    await vi.waitFor(() => expect(h.transport.get).toHaveBeenCalled());
    await h.db.meta.put({ key: blockedProfileKey(owner), value: 'deleted' });
    finish({ ...emptyOwnWeek(owner, week), purchasePrice: 100 });
    await sync;
    expect(await h.db.weeks.toArray()).toEqual([]);
    expect(h.transport.put).not.toHaveBeenCalled();
  });

  it('blocks delayed ledger/group caches and drops retained in-memory edits', async () => {
    const h = harness();
    let finish!: (value: { weeks: [] }) => void;
    const ledger = new LedgerCache(h.db, {
      isActive: () => true,
      get: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const fetching = ledger.refresh(owner);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await h.db.meta.put({ key: blockedProfileKey(owner), value: 'deleted' });
    finish({ weeks: [] });
    await fetching;
    await new SharedGroupsCache(h.db).write(owner, week, { groups: [], players: [] });
    expect(await ledger.read(owner)).toBeNull();
    expect(await new SharedGroupsCache(h.db).read(owner, week)).toBeNull();
    const pending = new PendingEdits(async () => {
      throw new Error('Storage full');
    });
    await expect(pending.enqueue(owner, week, { purchasePrice: 100 })).rejects.toThrow();
    pending.forget(owner);
    await pending.enqueue(owner, week, { purchasePrice: 110 });
    expect(pending.snapshot(owner, week).edits).toEqual([]);
  });
});

describe('portable profile download', () => {
  it('assembles every page and keeps only this profile’s local unsent data', async () => {
    const h = harness();
    await h.store.edit(owner, week, { purchasePrice: 100 });
    await h.store.edit('other', week, { purchasePrice: 110 });
    const savePending = vi.fn(async () => undefined);
    const data = await collectProfileExport(owner, {
      db: h.db,
      savePending,
      current: () => true,
      page: async (section, after): Promise<ProfileExportPage> => ({
        profile,
        hasRecoveryCode: true,
        section,
        records: [{ id: after ? 'second' : 'first' }],
        nextCursor: section === 'weeks' && !after ? 'cursor' : null,
      }),
    });
    expect(savePending).toHaveBeenCalledOnce();
    expect(data.server.weeks).toEqual([{ id: 'first' }, { id: 'second' }]);
    expect(data.localWeeks).toHaveLength(1);
    expect(data.localWeeks[0]).toMatchObject({ owner, dirty: true, data: { purchasePrice: 100 } });
    expect(JSON.stringify(data)).not.toContain('"other"');
  });

  it('aborts instead of downloading another identity after a profile switch', async () => {
    const h = harness();
    await expect(
      collectProfileExport(owner, {
        db: h.db,
        savePending: async () => undefined,
        current: () => true,
        page: async (section) => ({
          profile: { ...profile, id: 'other' },
          hasRecoveryCode: false,
          section,
          records: [],
          nextCursor: null,
        }),
      }),
    ).rejects.toThrow('could not be completed');
  });
});
