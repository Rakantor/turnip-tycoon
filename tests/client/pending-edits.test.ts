import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnipDatabase } from '../../src/client/data/database';
import {
  LOCAL_SAVE_ERROR,
  PendingEdits,
  withPendingEdits,
} from '../../src/client/data/pending-edits';
import { WeekStore, weekKey } from '../../src/client/data/sync';
import { emptyWeek, type WeeklyInputs } from '../../src/shared/week';

const owner = 'player-one';
const week = '2026-10-04';
const databases: TurnipDatabase[] = [];
const prices = (...known: (number | null)[]) => [
  ...known,
  ...Array<number | null>(12 - known.length).fill(null),
];

function harness() {
  const db = new TurnipDatabase(`pending-test-${crypto.randomUUID()}`);
  databases.push(db);
  const store = new WeekStore(db, {
    get: async (start) => emptyWeek(owner, start),
    put: async () => ({ revision: 1 }),
    isActive: () => false,
  });
  const write = async (
    id: string,
    start: string,
    patch: Partial<WeeklyInputs>,
    slots?: number[],
  ) => {
    await store.edit(id, start, patch, slots);
    return db.weeks.get(weekKey(id, start));
  };
  const persist = vi.fn(write);
  const queue = new PendingEdits(persist);
  return { db, store, persist, write, queue };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('unsaved local edits', () => {
  it('retains visible input and an honest error when IndexedDB rejects a write', async () => {
    const h = harness();
    const failure = new DOMException('Storage is full', 'QuotaExceededError');
    h.persist.mockRejectedValueOnce(failure);
    await expect(
      h.queue.enqueue(owner, week, { purchasePrice: 100, prices: prices(90) }, [0]),
    ).rejects.toBe(failure);
    expect(await h.db.weeks.get(weekKey(owner, week))).toBeUndefined();
    const retained = h.queue.snapshot(owner, week);
    expect(retained.error).toBe(LOCAL_SAVE_ERROR);
    expect(retained.edits).toHaveLength(1);
    expect(withPendingEdits(emptyWeek(owner, week), -1, retained)).toMatchObject({
      purchasePrice: 100,
      prices: prices(90),
    });

    // Reading fresh server data (or remounting the week view) cannot acknowledge
    // a local write that never happened. Retained intent remains above that data.
    const refreshed = { ...emptyWeek(owner, week), purchasePrice: 105, revision: 8 };
    expect(withPendingEdits(refreshed, 0, h.queue.snapshot(owner, week)).purchasePrice).toBe(100);
    expect(h.queue.snapshot(owner, week).error).toBe(LOCAL_SAVE_ERROR);
  });

  it('retries local persistence before dropping retained intent or its warning', async () => {
    const h = harness();
    h.persist.mockRejectedValueOnce(new DOMException('Denied', 'SecurityError'));
    await expect(h.queue.enqueue(owner, week, { purchasePrice: 100 })).rejects.toThrow('Denied');
    await h.queue.flush(owner, week);
    const saved = await h.db.weeks.get(weekKey(owner, week));
    expect(saved?.data.purchasePrice).toBe(100);
    expect(saved?.dirty).toBe(true);
    expect(h.queue.snapshot(owner, week)).toMatchObject({ edits: [], error: null });
    // The committed snapshot prevents an older live-query render flashing back
    // to its original value before IndexedDB emits its update.
    expect(
      withPendingEdits(emptyWeek(owner, week), -1, h.queue.snapshot(owner, week)).purchasePrice,
    ).toBe(100);
  });

  it('serializes edits and preserves a rapid explicit clear from a stale render', async () => {
    const h = harness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.persist.mockImplementationOnce(async (...args) => {
      await blocked;
      return h.write(...args);
    });
    const first = h.queue.enqueue(owner, week, { prices: prices(90) }, [0]);
    const second = h.queue.enqueue(owner, week, { prices: prices(null) }, [0]);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(
      withPendingEdits(emptyWeek(owner, week), -1, h.queue.snapshot(owner, week)).prices[0],
    ).toBeNull();
    release();
    await Promise.all([first, second]);
    expect(h.persist).toHaveBeenCalledTimes(2);
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.prices).toEqual(prices(null));
  });

  it('keeps a later failed edit after an earlier edit commits', async () => {
    const h = harness();
    await h.queue.enqueue(owner, week, { purchasePrice: 100 });
    h.persist.mockRejectedValueOnce(new DOMException('Storage is full', 'QuotaExceededError'));
    await expect(h.queue.enqueue(owner, week, { prices: prices(90) }, [0])).rejects.toThrow(
      'Storage is full',
    );
    const persisted = await h.db.weeks.get(weekKey(owner, week));
    expect(persisted?.data).toMatchObject({ purchasePrice: 100, prices: prices() });
    expect(
      withPendingEdits(persisted!.data, persisted!.version, h.queue.snapshot(owner, week)),
    ).toMatchObject({ purchasePrice: 100, prices: prices(90) });
    await h.queue.flush(owner, week);
    expect(h.persist).toHaveBeenCalledTimes(3);
    expect(h.persist.mock.calls[2][2]).toEqual({ prices: prices(90) });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data).toMatchObject({
      purchasePrice: 100,
      prices: prices(90),
    });
  });

  it('transfers only anonymous unsaved edits when bootstrap resolves a player', async () => {
    const h = harness();
    h.persist.mockRejectedValue(new DOMException('Storage unavailable', 'SecurityError'));
    await expect(h.queue.enqueue('unassigned', week, { purchasePrice: 100 })).rejects.toThrow();
    await expect(
      h.queue.enqueue('different-player', week, { purchasePrice: 110 }),
    ).rejects.toThrow();
    await h.queue.attachDrafts(owner);
    expect(h.queue.snapshot('unassigned', week).edits).toEqual([]);
    expect(h.queue.snapshot(owner, week).error).toBe(LOCAL_SAVE_ERROR);
    expect(
      withPendingEdits(emptyWeek(owner, week), -1, h.queue.snapshot(owner, week)).purchasePrice,
    ).toBe(100);
    expect(
      withPendingEdits(
        emptyWeek('different-player', week),
        -1,
        h.queue.snapshot('different-player', week),
      ).purchasePrice,
    ).toBe(110);
    h.persist.mockImplementation(h.write);
    await h.queue.flush(owner, week);
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data).toMatchObject({
      playerId: owner,
      purchasePrice: 100,
    });
    expect(await h.db.weeks.get(weekKey('different-player', week))).toBeUndefined();
    expect(h.queue.snapshot('different-player', week).edits).toHaveLength(1);
  });

  it('keeps another owner and another week isolated from a failed patch', async () => {
    const h = harness();
    h.persist.mockRejectedValueOnce(new DOMException('Storage is full', 'QuotaExceededError'));
    await expect(h.queue.enqueue(owner, week, { purchasePrice: 100 })).rejects.toThrow();
    expect(h.queue.snapshot('different-player', week).edits).toEqual([]);
    expect(h.queue.snapshot(owner, '2026-10-11').edits).toEqual([]);
    await h.queue.enqueue(owner, '2026-10-11', { purchasePrice: 95 });
    expect(h.queue.snapshot(owner, week).error).toBe(LOCAL_SAVE_ERROR);
    expect(h.queue.snapshot(owner, week).edits).toHaveLength(1);
  });

  it('waits for all local writes and newly queued weeks before allowing an app reload', async () => {
    const h = harness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.persist.mockImplementation(async (...args) => {
      await blocked;
      return h.write(...args);
    });
    const first = h.queue.enqueue(owner, week, { purchasePrice: 100 });
    const finished = vi.fn();
    const flushing = h.queue.flushAll().then(finished);
    const nextWeek = '2026-10-11';
    const next = h.queue.enqueue(owner, nextWeek, { purchasePrice: 95 });
    const other = h.queue.enqueue('another-player', week, { purchasePrice: 110 });
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    release();
    await Promise.all([first, next, other, flushing]);

    // A new store reads durable data; an app update need not wait for the API.
    h.db.close();
    await h.db.open();
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.purchasePrice).toBe(100);
    expect((await h.db.weeks.get(weekKey(owner, nextWeek)))?.data.purchasePrice).toBe(95);
    expect((await h.db.weeks.get(weekKey('another-player', week)))?.data.purchasePrice).toBe(110);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('blocks reload on any failed local save and succeeds after storage recovers', async () => {
    const h = harness();
    const failure = new DOMException('Storage is full', 'QuotaExceededError');
    h.persist.mockRejectedValue(failure);
    await expect(h.queue.enqueue(owner, week, { purchasePrice: 100 })).rejects.toBe(failure);
    await expect(h.queue.flushAll()).rejects.toBe(failure);
    expect(h.queue.snapshot(owner, week)).toMatchObject({ error: LOCAL_SAVE_ERROR });
    expect(h.queue.snapshot(owner, week).edits).toHaveLength(1);
    expect(await h.db.weeks.get(weekKey(owner, week))).toBeUndefined();
    h.persist.mockImplementation(h.write);
    await h.queue.flushAll();
    expect(h.queue.snapshot(owner, week)).toMatchObject({ edits: [], error: null });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.purchasePrice).toBe(100);
  });

  it('prefers the live record once it has observed a durable edit and later server data', async () => {
    const h = harness();
    await h.queue.enqueue(owner, week, { purchasePrice: 100 });
    const persisted = (await h.db.weeks.get(weekKey(owner, week)))!;
    const remote = { ...persisted.data, purchasePrice: 105, revision: 9 };
    expect(withPendingEdits(remote, persisted.version, h.queue.snapshot(owner, week))).toEqual(
      remote,
    );
  });
});
