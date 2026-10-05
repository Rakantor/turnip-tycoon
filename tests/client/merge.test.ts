import { describe, expect, it } from 'vitest';
import { mergeWeek, sameEntries } from '../../src/client/data/merge';
import type { Trade } from '../../src/shared/ledger';
import { emptyOwnWeek, type OwnWeekRecord } from '../../src/shared/week';

const week = (changes: Partial<OwnWeekRecord> = {}): OwnWeekRecord => ({
  ...emptyOwnWeek('player-one', '2026-10-04'),
  revision: 1,
  ...changes,
});
const prices = (...known: (number | null)[]) => [
  ...known,
  ...Array<number | null>(12 - known.length).fill(null),
];
const bought: Trade = { id: 'buy-1', kind: 'buy', quantity: 10000, price: 98 };
const sold: Trade = { id: 'sell-1', kind: 'sell', quantity: 3000, price: 165, slot: 4 };

describe('combining two devices’ edits', () => {
  it('takes each device’s changes to different entries', () => {
    const base = week({ purchasePrice: 98, prices: prices(87) });
    const local = week({ purchasePrice: 98, prices: prices(87, 84) });
    const remote = week({
      revision: 2,
      purchasePrice: 98,
      firstBuy: null,
      prices: prices(87, null, 80),
    });
    expect(mergeWeek(base, local, remote, 'local')).toEqual({
      week: { ...remote, prices: prices(87, 84, 80) },
      conflicts: [],
    });
  });

  it('agrees when both devices entered the same value', () => {
    const local = week({ prices: prices(87) });
    const remote = week({ revision: 2, prices: prices(87) });
    expect(mergeWeek(week(), local, remote, 'local').conflicts).toEqual([]);
  });

  it.each(['local', 'remote'] as const)(
    'reports an entry both devices changed differently, keeping the %s side',
    (prefer) => {
      const local = week({ purchasePrice: 100, prices: prices(87, 84) });
      const remote = week({ revision: 2, purchasePrice: 105, prices: prices(87, 90) });
      const merged = mergeWeek(week({ prices: prices(87) }), local, remote, prefer);
      expect(merged.conflicts).toEqual(['purchasePrice', 'price:1']);
      expect(merged.week).toMatchObject(
        prefer === 'local'
          ? { purchasePrice: 100, prices: prices(87, 84) }
          : { purchasePrice: 105, prices: prices(87, 90) },
      );
    },
  );

  it('combines trades one by one, this device’s order first', () => {
    const other: Trade = { id: 'buy-2', kind: 'buy', quantity: 4000, price: 94 };
    const base = week({ trades: [bought] });
    const merged = mergeWeek(
      base,
      week({ trades: [bought, sold] }),
      week({ revision: 2, trades: [other, bought] }),
      'local',
    );
    expect(merged).toEqual({
      week: week({ revision: 2, trades: [bought, sold, other] }),
      conflicts: [],
    });
  });

  it('keeps a trade removed on one device unless the other changed it', () => {
    const base = week({ trades: [bought, sold] });
    expect(
      mergeWeek(
        base,
        week({ trades: [bought] }),
        week({ revision: 2, trades: [bought, sold] }),
        'local',
      ).week.trades,
    ).toEqual([bought]);
    const changed = mergeWeek(
      base,
      week({ trades: [bought] }),
      week({ revision: 2, trades: [bought, { ...sold, price: 170 }] }),
      'remote',
    );
    expect(changed.conflicts).toEqual(['trade:sell-1']);
    expect(changed.week.trades).toEqual([bought, { ...sold, price: 170 }]);
  });

  it.each(['local', 'remote'] as const)(
    'makes the whole list one choice when combined trades no longer add up (%s kept)',
    (prefer) => {
      const base = week({ trades: [bought] });
      const local = week({ trades: [bought, { ...sold, quantity: 6000 }] });
      const remote = week({
        revision: 2,
        trades: [bought, { ...sold, id: 'sell-2', quantity: 6000, slot: 5 }],
      });
      const merged = mergeWeek(base, local, remote, prefer);
      expect(merged.conflicts).toEqual(['trades']);
      expect(merged.week.trades).toEqual(prefer === 'local' ? local.trades : remote.trades);
    },
  );

  it('compares entries without revisions', () => {
    expect(
      sameEntries(week({ trades: [bought] }), week({ revision: 9, trades: [{ ...bought }] })),
    ).toBe(true);
    expect(sameEntries(week({ trades: [bought] }), week({ trades: [] }))).toBe(false);
  });
});
