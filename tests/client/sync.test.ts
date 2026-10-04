import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/client/data/api';
import { TurnipDatabase } from '../../src/client/data/database';
import { WeekStore, weekKey, type WeekTransport } from '../../src/client/data/sync';
import { emptyWeek, type WeekMutation, type WeekRecord } from '../../src/shared/week';

const owner = 'player-one';
const week = '2026-10-04';
const databases: TurnipDatabase[] = [];

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function prices(...known: (number | null)[]): (number | null)[] {
  return [...known, ...Array<number | null>(12 - known.length).fill(null)];
}

function harness(initial = emptyWeek(owner, week)) {
  const db = new TurnipDatabase(`sync-test-${crypto.randomUUID()}`);
  databases.push(db);
  const remote = new Map<string, WeekRecord>([[initial.weekStart, structuredClone(initial)]]);
  const receipts = new Map<string, { revision: number }>();
  let active = owner;
  const transport = {
    isActive: vi.fn((id: string) => active === id),
    get: vi.fn(async (weekStart: string): Promise<WeekRecord> =>
      structuredClone(remote.get(weekStart) ?? emptyWeek(owner, weekStart)),
    ),
    put: vi.fn(async (weekStart: string, body: WeekMutation): Promise<{ revision: number }> => {
      const duplicate = receipts.get(body.mutationId);
      if (duplicate) return duplicate;
      const current = remote.get(weekStart) ?? emptyWeek(owner, weekStart);
      if (current.revision !== body.baseRevision)
        throw new ApiError(409, 'REVISION_CONFLICT', 'Changed elsewhere', structuredClone(current));
      const updated = {
        ...current,
        purchasePrice: body.purchasePrice,
        firstBuy: body.firstBuy,
        previousPattern: body.previousPattern,
        prices: [...body.prices],
        revision: current.revision + 1,
      };
      remote.set(weekStart, updated);
      const result = { revision: updated.revision };
      receipts.set(body.mutationId, result);
      return result;
    }),
  } satisfies WeekTransport;
  const store = new WeekStore(db, transport);
  return {
    db,
    remote,
    transport,
    store,
    setActive: (id: string) => {
      active = id;
    },
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe('durable weekly sync', () => {
  it('defaults a new offline week from the immediately preceding cached prices', async () => {
    const h = harness();
    const previous = '2026-09-27';
    await h.store.edit(owner, previous, {
      purchasePrice: 100,
      previousPattern: 'small-spike',
      prices: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35],
    });
    h.setActive('offline');
    await h.store.initialize(owner, week);
    expect(await h.db.weeks.get(weekKey(owner, week))).toMatchObject({
      dirty: false,
      hydrated: false,
      data: { previousPattern: 'decreasing', revision: 0 },
    });
    expect(h.transport.get).not.toHaveBeenCalled();
    expect(h.transport.put).not.toHaveBeenCalled();

    await h.store.edit(owner, week, { purchasePrice: 100 });
    h.setActive(owner);
    await h.store.sync(owner, week);
    expect(h.remote.get(week)?.previousPattern).toBe('decreasing');
  });

  it.each(['missing', 'ambiguous', 'inconsistent', 'older', 'another-player', 'conflict'])(
    'keeps the new-week default Unknown for %s prior data',
    async (scenario) => {
      const h = harness();
      const previousOwner = scenario === 'another-player' ? 'another-player' : owner;
      const previous = scenario === 'older' ? '2026-09-20' : '2026-09-27';
      if (scenario !== 'missing') {
        await h.store.edit(previousOwner, previous, {
          purchasePrice: 100,
          prices:
            scenario === 'ambiguous'
              ? prices()
              : scenario === 'inconsistent'
                ? prices(660)
                : [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35],
        });
        if (scenario === 'conflict') {
          await h.db.weeks.update(weekKey(owner, previous), {
            conflict: { ...emptyWeek(owner, previous), revision: 2 },
          });
        }
      }
      await h.store.initialize(owner, week);
      expect((await h.db.weeks.get(weekKey(owner, week)))?.data.previousPattern).toBeNull();
    },
  );

  it.each([null, 'large-spike'] as const)(
    'preserves an existing saved previous pattern of %s',
    async (previousPattern) => {
      const h = harness({ ...emptyWeek(owner, week), revision: 2, previousPattern });
      await h.store.edit(owner, '2026-09-27', {
        purchasePrice: 100,
        prices: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35],
      });
      await h.store.initialize(owner, week);
      await h.store.sync(owner, week);
      await h.store.initialize(owner, week);
      expect((await h.db.weeks.get(weekKey(owner, week)))?.data.previousPattern).toBe(
        previousPattern,
      );
      expect(h.transport.put).not.toHaveBeenCalled();
    },
  );

  it('preserves an explicit Unknown selected while the new-week default is loading', async () => {
    const h = harness();
    const entered = defer<void>();
    const response = defer<WeekRecord>();
    h.transport.get.mockImplementationOnce(() => {
      entered.resolve();
      return response.promise;
    });
    await h.store.initialize(owner, week);
    const syncing = h.store.sync(owner, week);
    await entered.promise;
    await h.store.edit(owner, week, { previousPattern: null });
    response.resolve({ ...emptyWeek(owner, week), previousPattern: 'decreasing' });
    await syncing;
    expect(h.remote.get(week)?.previousPattern).toBeNull();
    expect(h.transport.put.mock.calls[0][1].previousPattern).toBeNull();
  });

  it('replaces a stale clean cached default with the server’s Unknown', async () => {
    const h = harness();
    const previous = '2026-09-27';
    await h.store.edit(owner, previous, {
      purchasePrice: 100,
      prices: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35],
    });
    await h.store.sync(owner, previous);
    await h.store.initialize(owner, week);
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.previousPattern).toBe('decreasing');
    // A second device has since corrected the prior week to an ambiguous pattern.
    await h.store.sync(owner, week);
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.previousPattern).toBeNull();
    expect(h.transport.put).toHaveBeenCalledTimes(1);
  });

  it.each([
    { priorPrices: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35], expected: 'decreasing' },
    { priorPrices: prices(), expected: null },
  ] as const)(
    'uses unsynced prior prices over a stale server default: $expected',
    async ({ priorPrices, expected }) => {
      const h = harness({ ...emptyWeek(owner, week), previousPattern: 'large-spike' });
      await h.store.edit(owner, '2026-09-27', {
        purchasePrice: 100,
        prices: [...priorPrices],
      });
      await h.store.initialize(owner, week);
      await h.store.edit(owner, week, { purchasePrice: 100 });
      await h.store.sync(owner, week);
      expect(h.remote.get(week)?.previousPattern).toBe(expected);
    },
  );

  it('combines rapid field edits from the same stale rendered price snapshot', async () => {
    const h = harness();
    // Both blur handlers saw the original empty render. Each explicitly marks
    // only its own changed slot; the second snapshot must not erase the first.
    await h.store.edit(owner, week, { prices: prices(90) }, [0]);
    await h.store.edit(owner, week, { prices: prices(null, 85) }, [1]);
    expect((await h.db.weeks.get(weekKey(owner, week)))?.data.prices).toEqual(prices(90, 85));
    await h.store.sync(owner, week);
    expect(h.remote.get(week)?.prices).toEqual(prices(90, 85));
  });

  it('merges only edited anonymous fields into a recovered server week', async () => {
    const h = harness({
      ...emptyWeek(owner, week),
      revision: 3,
      purchasePrice: 96,
      firstBuy: false,
      previousPattern: 'decreasing',
      prices: prices(91, 87, 82),
    });
    await h.store.edit('unassigned', week, { purchasePrice: 100, prices: prices(null, null, 112) });
    await h.store.edit('another-player', week, { purchasePrice: 110 });
    await h.store.attachDrafts(owner);
    expect(await h.db.weeks.get(weekKey('unassigned', week))).toBeUndefined();
    await h.store.sync(owner, week);
    const saved = h.remote.get(week)!;
    expect(saved).toMatchObject({
      playerId: owner,
      purchasePrice: 100,
      firstBuy: false,
      previousPattern: 'decreasing',
      revision: 4,
    });
    expect(saved.prices).toEqual(prices(91, 87, 112));
    expect((await h.db.weeks.get(weekKey('another-player', week)))?.data.purchasePrice).toBe(110);
  });

  it('retries a lost acknowledgement with its immutable body before sending newer edits', async () => {
    const h = harness();
    const commit = h.transport.put.getMockImplementation()!;
    h.transport.put.mockImplementationOnce(async (weekStart, body) => {
      await commit(weekStart, body);
      throw new Error('Connection closed after commit');
    });
    await h.store.edit(owner, week, { purchasePrice: 100, prices: prices(90) });
    await expect(h.store.sync(owner, week)).rejects.toThrow('Connection closed');
    const firstBody = structuredClone(h.transport.put.mock.calls[0][1]);
    const pendingBefore = structuredClone((await h.db.weeks.get(weekKey(owner, week)))?.pending);
    await h.store.edit(owner, week, { prices: prices(90, 85) });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.pending).toEqual(pendingBefore);

    // A new store represents a reload; the retry comes from IndexedDB, not memory.
    const reloaded = new WeekStore(h.db, h.transport);
    await reloaded.sync(owner, week);
    expect(h.transport.put).toHaveBeenCalledTimes(3);
    expect(h.transport.put.mock.calls[1][1]).toEqual(firstBody);
    const newest = h.transport.put.mock.calls[2][1];
    expect(newest.mutationId).not.toBe(firstBody.mutationId);
    expect(newest.baseRevision).toBe(1);
    expect(newest.prices).toEqual(prices(90, 85));
    expect(h.transport.get).toHaveBeenCalledTimes(1);
    expect(h.remote.get(week)?.revision).toBe(2);
    expect(await h.db.weeks.get(weekKey(owner, week))).toMatchObject({
      dirty: false,
      data: { revision: 2, prices: prices(90, 85) },
    });
    expect((await h.db.weeks.get(weekKey(owner, week)))?.pending).toBeUndefined();
  });

  it('preserves an edit made while an earlier mutation is in flight', async () => {
    const h = harness();
    const entered = defer<void>();
    const release = defer<void>();
    const commit = h.transport.put.getMockImplementation()!;
    h.transport.put.mockImplementationOnce(async (weekStart, body) => {
      entered.resolve();
      await release.promise;
      return commit(weekStart, body);
    });
    await h.store.edit(owner, week, { purchasePrice: 100, prices: prices(90) });
    const syncing = h.store.sync(owner, week);
    await entered.promise;
    await h.store.edit(owner, week, { purchasePrice: 105, prices: prices(90, 86) });
    release.resolve();
    await syncing;
    expect(h.transport.put).toHaveBeenCalledTimes(2);
    expect(h.transport.put.mock.calls[0][1]).toMatchObject({
      purchasePrice: 100,
      prices: prices(90),
      baseRevision: 0,
    });
    expect(h.transport.put.mock.calls[1][1]).toMatchObject({
      purchasePrice: 105,
      prices: prices(90, 86),
      baseRevision: 1,
    });
    expect(await h.db.weeks.get(weekKey(owner, week))).toMatchObject({
      dirty: false,
      data: { purchasePrice: 105, prices: prices(90, 86), revision: 2 },
    });
  });

  it.each(['local', 'remote'] as const)(
    'preserves a conflict until the user chooses %s',
    async (choice) => {
      const original = {
        ...emptyWeek(owner, week),
        revision: 1,
        purchasePrice: 100,
        prices: prices(90),
      };
      const h = harness(original);
      await h.store.sync(owner, week);
      await h.store.edit(owner, week, { prices: prices(90, 85) });
      const changedElsewhere = {
        ...original,
        revision: 2,
        purchasePrice: 105,
        prices: prices(90, 86, 82),
      };
      h.remote.set(week, changedElsewhere);
      await h.store.sync(owner, week);
      expect(h.transport.put).not.toHaveBeenCalled();
      const conflict = await h.db.weeks.get(weekKey(owner, week));
      expect(conflict?.data.prices).toEqual(prices(90, 85));
      expect(conflict?.conflict).toEqual(changedElsewhere);
      await h.store.sync(owner, week);
      expect(h.transport.put).not.toHaveBeenCalled();
      await h.store.resolve(owner, week, choice);
      await h.store.sync(owner, week);
      const result = await h.db.weeks.get(weekKey(owner, week));
      expect(result?.conflict).toBeUndefined();
      expect(result?.dirty).toBe(false);
      if (choice === 'remote') {
        expect(result?.data).toEqual(changedElsewhere);
        expect(h.transport.put).not.toHaveBeenCalled();
      } else {
        expect(h.transport.put.mock.calls[0][1]).toMatchObject({
          baseRevision: 2,
          purchasePrice: 100,
          prices: prices(90, 85),
        });
        expect(result?.data.revision).toBe(3);
      }
    },
  );

  it('handles a revision conflict that races with a write and renews the mutation after resolution', async () => {
    const h = harness({ ...emptyWeek(owner, week), revision: 1 });
    const commit = h.transport.put.getMockImplementation()!;
    h.transport.put.mockImplementationOnce(async (weekStart, body) => {
      h.remote.set(week, { ...emptyWeek(owner, week), revision: 2, purchasePrice: 105 });
      return commit(weekStart, body);
    });
    await h.store.edit(owner, week, { purchasePrice: 100 });
    await h.store.sync(owner, week);
    const failedId = h.transport.put.mock.calls[0][1].mutationId;
    expect((await h.db.weeks.get(weekKey(owner, week)))?.conflict?.revision).toBe(2);
    await h.store.resolve(owner, week, 'local');
    await h.store.sync(owner, week);
    expect(h.transport.put.mock.calls[1][1]).toMatchObject({ baseRevision: 2, purchasePrice: 100 });
    expect(h.transport.put.mock.calls[1][1].mutationId).not.toBe(failedId);
    expect(h.remote.get(week)?.purchasePrice).toBe(100);
  });

  it("never sends an inactive owner's draft through the current session", async () => {
    const h = harness();
    await h.store.edit(owner, week, { purchasePrice: 100 });
    h.setActive('different-player');
    await h.store.sync(owner, week);
    expect(h.transport.get).not.toHaveBeenCalled();
    expect(h.transport.put).not.toHaveBeenCalled();
    expect((await h.db.weeks.get(weekKey(owner, week)))?.dirty).toBe(true);
  });

  it('discards a hydration response when the session owner changes while fetching', async () => {
    const h = harness();
    const entered = defer<void>();
    const remote = defer<WeekRecord>();
    h.transport.get.mockImplementationOnce(() => {
      entered.resolve();
      return remote.promise;
    });
    await h.store.edit(owner, week, { purchasePrice: 100 });
    const syncing = h.store.sync(owner, week);
    await entered.promise;
    h.setActive('different-player');
    remote.resolve({ ...emptyWeek('different-player', week), purchasePrice: 110, revision: 9 });
    await syncing;
    expect(h.transport.put).not.toHaveBeenCalled();
    expect(await h.db.weeks.get(weekKey(owner, week))).toMatchObject({
      hydrated: false,
      dirty: true,
      data: { playerId: owner, purchasePrice: 100, revision: 0 },
    });
    expect(await h.db.weeks.get(weekKey('different-player', week))).toBeUndefined();
  });

  it("keeps an old week's pending mutation when a new week is opened and saved", async () => {
    const h = harness();
    h.transport.put.mockRejectedValueOnce(new Error('Offline'));
    await h.store.edit(owner, week, { purchasePrice: 100, prices: prices(90) });
    await expect(h.store.sync(owner, week)).rejects.toThrow('Offline');
    const old = await h.db.weeks.get(weekKey(owner, week));
    const next = '2026-10-11';
    await h.store.edit(owner, next, { purchasePrice: 95 });
    await h.store.sync(owner, next);
    expect(await h.db.weeks.get(weekKey(owner, week))).toEqual(old);
    expect((await h.db.weeks.get(weekKey(owner, next)))?.dirty).toBe(false);
    await h.store.sync(owner, week);
    expect(h.transport.put.mock.calls.at(-1)?.[1].mutationId).toBe(old?.pending?.mutationId);
    expect(h.remote.get(week)?.prices).toEqual(prices(90));
  });
});
