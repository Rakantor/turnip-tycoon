import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type LocalWeek, type StoredWeek, TurnipDatabase } from '../../src/client/data/database';
import {
  HistoryCache,
  type HistoryPage,
  withLocalHistory,
  withOlderPage,
} from '../../src/client/data/history-cache';
import { weekKey } from '../../src/client/data/sync';
import type { Trade } from '../../src/shared/ledger';
import { emptyWeek } from '../../src/shared/week';

const owner = 'player-one';
const nextWeek = '2026-10-18';
const thisWeek = '2026-10-11';
const lastWeek = '2026-10-04';
const twoAgo = '2026-09-27';
const threeAgo = '2026-09-20';
const databases: TurnipDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

const purchase: Trade = { id: 'buy-1', kind: 'buy', quantity: 100, price: 95 };
const sale: Trade = { id: 'sell-1', kind: 'sell', quantity: 40, price: 150, slot: 3 };

function week(weekStart: string, revision: number, overrides: Partial<StoredWeek> = {}) {
  const stored: StoredWeek = { ...emptyWeek(owner, weekStart), revision, trades: [], ...overrides };
  return stored;
}

function row(data: StoredWeek, overrides: Partial<LocalWeek> = {}) {
  const local: LocalWeek = {
    key: weekKey(owner, data.weekStart),
    owner,
    weekStart: data.weekStart,
    data,
    hydrated: true,
    version: 1,
    dirty: false,
    fields: [],
    slots: [],
    ...overrides,
  };
  return local;
}

const starts = (weeks: { weekStart: string }[]) => weeks.map((entry) => entry.weekStart);

describe('saved history', () => {
  function harness() {
    const db = new TurnipDatabase(`history-test-${crypto.randomUUID()}`);
    databases.push(db);
    let active = owner;
    const pages: Record<string, HistoryPage> = {
      [nextWeek]: { weeks: [week(thisWeek, 1), week(lastWeek, 2)], nextCursor: lastWeek },
      [lastWeek]: { weeks: [week(twoAgo, 1)], nextCursor: null },
    };
    const transport = {
      get: vi.fn(async (before: string) => structuredClone(pages[before])),
      isActive: vi.fn((id: string) => id === active),
    };
    return {
      db,
      transport,
      cache: new HistoryCache(db, transport),
      setActive: (id: string) => {
        active = id;
      },
    };
  }
  it('reads the newest page from next week back, so this week is included', async () => {
    const h = harness();
    const first = await h.cache.first(owner, thisWeek);
    expect(h.transport.get).toHaveBeenCalledWith(nextWeek);
    expect(starts(first!.weeks)).toEqual([thisWeek, lastWeek]);
  });

  it('reads the page after the list’s oldest week, and nothing once it reaches the first', async () => {
    const h = harness();
    const list: HistoryPage = { weeks: [week(lastWeek, 2)], nextCursor: lastWeek };
    expect(await h.cache.older(owner, list)).toEqual({
      weeks: [week(twoAgo, 1)],
      nextCursor: null,
    });
    expect(await h.cache.older(owner, { ...list, nextCursor: null })).toBeNull();
    expect(h.transport.get).toHaveBeenCalledTimes(1);
  });

  it('adds an older page after the list, once each', () => {
    const list: HistoryPage = { weeks: [week(lastWeek, 2)], nextCursor: lastWeek };
    const page: HistoryPage = { weeks: [week(lastWeek, 2), week(twoAgo, 1)], nextCursor: twoAgo };
    expect(withOlderPage(list, page)).toEqual({
      weeks: [week(lastWeek, 2), week(twoAgo, 1)],
      nextCursor: twoAgo,
    });
  });

  it('drops a page for a profile that isn’t signed in, or that changes while reading', async () => {
    const h = harness();
    h.setActive('someone-else');
    expect(await h.cache.first(owner, thisWeek)).toBeNull();
    expect(h.transport.get).not.toHaveBeenCalled();
    h.setActive(owner);
    h.transport.get.mockImplementationOnce(async () => {
      h.setActive('someone-else');
      return { weeks: [], nextCursor: null };
    });
    expect(await h.cache.first(owner, thisWeek)).toBeNull();
  });

  it('keeps the list it is given, and ignores a saved value it cannot read', async () => {
    const h = harness();
    const list: HistoryPage = { weeks: [week(lastWeek, 2)], nextCursor: null };
    await h.cache.save(owner, list);
    expect(await h.cache.read(owner)).toEqual(list);
    await h.db.meta.put({ key: `history:${owner}`, value: { weeks: [] } });
    expect(await h.cache.read(owner)).toBeNull();
  });
});

describe('history with this device’s weeks', () => {
  const list: HistoryPage = {
    weeks: [week(lastWeek, 3, { trades: [purchase, sale] }), week(twoAgo, 1)],
    nextCursor: twoAgo,
  };

  it('shows the saved list, newest first, when this device knows nothing newer', () => {
    expect(
      withLocalHistory(list, [row(week(lastWeek, 3, { purchasePrice: 99 }))], thisWeek),
    ).toEqual(list.weeks);
  });

  it('shows this device’s unsent edits and later reads in place of the saved weeks', () => {
    const edited = week(lastWeek, 3, { trades: [purchase] });
    const later = week(twoAgo, 2, { purchasePrice: 101 });
    expect(
      withLocalHistory(
        list,
        [row(edited, { dirty: true, fields: ['trades'] }), row(later)],
        thisWeek,
      ),
    ).toEqual([edited, later]);
  });

  it('puts edits made before this device read a week on top of the saved copy', () => {
    const draft = week(lastWeek, 0, { purchasePrice: 97 });
    const [shown] = withLocalHistory(
      list,
      [row(draft, { hydrated: false, dirty: true, fields: ['purchasePrice'] })],
      thisWeek,
    );
    expect(shown).toEqual({ ...list.weeks[0], purchasePrice: 97 });
  });

  it('keeps the saved copy of a week waiting for a conflict choice', () => {
    const conflicted = week(lastWeek, 3, { trades: [] });
    expect(
      withLocalHistory(
        list,
        [row(conflicted, { dirty: true, fields: ['trades'], conflict: week(lastWeek, 4) })],
        thisWeek,
      ),
    ).toEqual(list.weeks);
  });

  it('adds weeks saved since the list loaded, but not older weeks it never reached', () => {
    const rows = [
      // Last week ended after the list loaded, and this week had no entries yet.
      row(week(nextWeek, 1, { trades: [purchase, sale] })),
      row(week(thisWeek, 2)),
      row(week(threeAgo, 4)),
      // Opened but never saved.
      row(week('2026-10-25', 0)),
    ];
    expect(starts(withLocalHistory(list, rows, nextWeek))).toEqual([
      nextWeek,
      thisWeek,
      lastWeek,
      twoAgo,
    ]);
  });

  it('adds older saved weeks once the list reaches back to the first one', () => {
    const complete = { ...list, nextCursor: null };
    expect(starts(withLocalHistory(complete, [row(week(threeAgo, 1))], thisWeek))).toEqual([
      lastWeek,
      twoAgo,
      threeAgo,
    ]);
  });

  it('shows this week only once something has been sold', () => {
    const held = list.weeks.concat(week(thisWeek, 1, { trades: [purchase] }));
    expect(starts(withLocalHistory({ ...list, weeks: held }, [], thisWeek))).toEqual([
      lastWeek,
      twoAgo,
    ]);
    const sold = week(thisWeek, 1, { trades: [purchase, sale] });
    expect(
      starts(
        withLocalHistory(
          { ...list, weeks: held },
          [row(sold, { dirty: true, fields: ['trades'] })],
          thisWeek,
        ),
      ),
    ).toEqual([thisWeek, lastWeek, twoAgo]);
  });

  it('leaves out weeks ahead of this device’s clock', () => {
    const ahead = { ...list, weeks: [week(nextWeek, 1, { trades: [purchase, sale] })] };
    expect(withLocalHistory(ahead, [], thisWeek)).toEqual([]);
  });

  it('shows only this week from the device before any list has loaded', () => {
    const rows = [
      row(week(thisWeek, 1, { trades: [purchase, sale] })),
      row(week(lastWeek, 3, { trades: [purchase, sale] })),
    ];
    expect(starts(withLocalHistory(null, rows, thisWeek))).toEqual([thisWeek]);
  });
});
