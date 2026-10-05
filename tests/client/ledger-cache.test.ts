import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnipDatabase, type LocalWeek } from '../../src/client/data/database';
import { LedgerCache, withLocalWeeks, type SavedLedger } from '../../src/client/data/ledger-cache';
import { WeekStore, weekKey } from '../../src/client/data/sync';
import { overallProfit, type LedgerWeek, type Trade } from '../../src/shared/ledger';
import { emptyOwnWeek, emptyWeek, type WeekMutation } from '../../src/shared/week';

const owner = 'player-one';
const week = '2026-10-04';
const databases: TurnipDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

function makeDatabase() {
  const db = new TurnipDatabase(`ledger-test-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}

const serverWeeks: LedgerWeek[] = [
  { weekStart: week, bought: 10000, spent: 956000, sold: 3000, earned: 495000 },
  { weekStart: '2026-09-27', bought: 5000, spent: 505000, sold: 4000, earned: 528000 },
];
const purchases: Trade[] = [
  { id: 'buy-1', kind: 'buy', quantity: 4000, price: 98 },
  { id: 'buy-2', kind: 'buy', quantity: 6000, price: 94 },
];
const morningSale: Trade = { id: 'sell-1', kind: 'sell', quantity: 3000, price: 165, slot: 4 };
const laterSale: Trade = { id: 'sell-2', kind: 'sell', quantity: 7000, price: 400, slot: 7 };

function row(weekStart: string, overrides: Partial<LocalWeek> & { trades?: Trade[] } = {}) {
  const { trades, ...rest } = overrides;
  const local: LocalWeek = {
    key: weekKey(owner, weekStart),
    owner,
    weekStart,
    // Without `trades`, this is a week saved before trades existed.
    data: { ...emptyWeek(owner, weekStart), revision: 1, ...(trades ? { trades } : {}) },
    hydrated: true,
    version: 1,
    dirty: false,
    fields: [],
    slots: [],
    ...rest,
  };
  return local;
}

describe('saved ledger', () => {
  function harness() {
    const db = makeDatabase();
    let active = owner;
    const transport = {
      get: vi.fn(async () => ({ weeks: structuredClone(serverWeeks) })),
      isActive: vi.fn((id: string) => id === active),
    };
    return {
      db,
      transport,
      cache: new LedgerCache(db, transport),
      setActive: (id: string) => {
        active = id;
      },
    };
  }

  it('reads the server at most once a minute, and again after the clock moves back', async () => {
    const h = harness();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await h.cache.refresh(owner);
    expect(await h.cache.read(owner)).toEqual({ weeks: serverWeeks, fetchedAt: 1_000_000 });
    now.mockReturnValue(1_059_999);
    await h.cache.refresh(owner);
    expect(h.transport.get).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_060_000);
    await h.cache.refresh(owner);
    expect(h.transport.get).toHaveBeenCalledTimes(2);
    now.mockReturnValue(5);
    await h.cache.refresh(owner);
    expect(h.transport.get).toHaveBeenCalledTimes(3);
  });

  it('saves nothing for a profile that isn’t signed in, or that changes while reading', async () => {
    const h = harness();
    h.setActive('someone-else');
    await h.cache.refresh(owner);
    expect(h.transport.get).not.toHaveBeenCalled();
    h.setActive(owner);
    h.transport.get.mockImplementationOnce(async () => {
      h.setActive('someone-else');
      return { weeks: serverWeeks };
    });
    await h.cache.refresh(owner);
    expect(await h.cache.read(owner)).toBeNull();
  });

  it('ignores a saved value it cannot read', async () => {
    const h = harness();
    await h.db.meta.put({ key: `ledger:${owner}`, value: { weeks: 'not-a-list' } });
    expect(await h.cache.read(owner)).toBeNull();
  });
});

describe('overall profit from this device', () => {
  const saved: SavedLedger = { weeks: serverWeeks, fetchedAt: 5000 };

  it('uses the server’s weeks when this device knows nothing newer', () => {
    expect(
      withLocalWeeks(saved, [
        row(week, { trades: [...purchases, morningSale], syncedAt: 4000 }),
        // Only a price waits to upload; its trades are the server's.
        row('2026-09-27', { dirty: true, fields: ['purchasePrice'], trades: [] }),
      ]),
    ).toEqual(serverWeeks);
  });

  it('counts unsent trade edits and weeks synced since the ledger was fetched', () => {
    const weeks = withLocalWeeks(saved, [
      row(week, {
        dirty: true,
        fields: ['trades'],
        trades: [...purchases, morningSale, laterSale],
      }),
      row('2026-09-20', {
        trades: [{ id: 'buy-3', kind: 'buy', quantity: 100, price: 90 }],
        syncedAt: 6000,
      }),
    ]);
    expect(weeks).toEqual([
      { weekStart: week, bought: 10000, spent: 956000, sold: 10000, earned: 3295000 },
      serverWeeks[1],
      { weekStart: '2026-09-20', bought: 100, spent: 9000, sold: 0, earned: 0 },
    ]);
    expect(overallProfit(weeks, week)).toBe(2339000 + 23000 - 9000);
  });

  it('drops a week whose trades this device removed', () => {
    expect(
      withLocalWeeks(saved, [row('2026-09-27', { dirty: true, fields: ['trades'], trades: [] })]),
    ).toEqual([serverWeeks[0]]);
  });

  it('ignores weeks saved on this device before trades existed', () => {
    expect(withLocalWeeks(saved, [row('2026-09-27', { syncedAt: 9000 })])).toEqual(serverWeeks);
  });

  it('counts synced weeks before the ledger was ever fetched', () => {
    expect(
      withLocalWeeks(null, [
        row(week, { trades: purchases, syncedAt: 1 }),
        row('2026-09-27', { trades: purchases }),
      ]),
    ).toEqual([{ weekStart: week, bought: 10000, spent: 956000, sold: 0, earned: 0 }]);
  });

  it('counts an uploaded sale until a later ledger fetch includes it', async () => {
    const db = makeDatabase();
    const remote = { ...emptyOwnWeek(owner, week), revision: 1, trades: purchases };
    const store = new WeekStore(db, {
      get: async () => structuredClone(remote),
      put: async (_weekStart: string, body: WeekMutation) => {
        Object.assign(remote, {
          trades: body.trades ?? remote.trades,
          revision: remote.revision + 1,
        });
        return { revision: remote.revision };
      },
      isActive: () => true,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await store.sync(owner, week);
    const fetched: SavedLedger = {
      weeks: [{ weekStart: week, bought: 10000, spent: 956000, sold: 0, earned: 0 }],
      fetchedAt: 2000,
    };
    expect(withLocalWeeks(fetched, await db.weeks.toArray())).toEqual(fetched.weeks);

    now.mockReturnValue(3000);
    await store.edit(owner, week, { trades: [...purchases, morningSale] });
    const sold = { weekStart: week, bought: 10000, spent: 956000, sold: 3000, earned: 495000 };
    expect(withLocalWeeks(fetched, await db.weeks.toArray())).toEqual([sold]);
    await store.sync(owner, week);
    expect((await db.weeks.get(weekKey(owner, week)))?.dirty).toBe(false);
    expect(withLocalWeeks(fetched, await db.weeks.toArray())).toEqual([sold]);
    // A later fetch is newer than this device, including another device's sale.
    const later = { ...sold, sold: 5000, earned: 825000 };
    expect(withLocalWeeks({ weeks: [later], fetchedAt: 4000 }, await db.weeks.toArray())).toEqual([
      later,
    ]);
  });
});
