import { describe, expect, it } from 'vitest';
import {
  averageCost,
  averageSale,
  costOf,
  heldCost,
  madeSoFar,
  NO_TRADES,
  overallProfit,
  totalsOf,
  tradesProblem,
  unsold,
  weekResult,
  type Trade,
  type TradeProblem,
} from '../../src/shared/ledger';

let nextId = 0;
const buy = (quantity: number, price: number): Trade => ({
  id: `trade-${++nextId}`,
  kind: 'buy',
  quantity,
  price,
});
const sell = (quantity: number, price: number, slot = 4): Trade => ({
  id: `trade-${++nextId}`,
  kind: 'sell',
  quantity,
  price,
  slot,
});

// The plan's worked example: two purchases at different prices, sold in two goes.
const bought = [buy(4000, 98), buy(6000, 94)];

describe('turnip ledger', () => {
  it('pools purchases at their average cost', () => {
    const totals = totalsOf(bought);
    expect(totals).toEqual({ bought: 10000, spent: 956000, sold: 0, earned: 0 });
    expect(averageCost(totals)).toBeCloseTo(95.6);
    expect(unsold(totals)).toBe(10000);
    expect(madeSoFar(totals)).toBe(0);
  });

  it('counts profit on what was sold while the rest is held', () => {
    const totals = totalsOf([...bought, sell(3000, 142, 2)]);
    expect(madeSoFar(totals)).toBe(139200);
    expect(unsold(totals)).toBe(7000);
    expect(heldCost(totals)).toBe(669200);
  });

  it('settles a sold-out week at bells earned minus bells spent', () => {
    const totals = totalsOf([...bought, sell(3000, 142, 2), sell(7000, 488, 7)]);
    expect(weekResult(totals)).toBe(2886000);
    expect(madeSoFar(totals)).toBe(2886000);
    expect(averageSale(totals)).toBeCloseTo(384.2);
  });

  it('counts rotted turnips as a loss at what they cost', () => {
    const totals = totalsOf([...bought, sell(3000, 142, 2), sell(6000, 488, 7)]);
    expect(unsold(totals)).toBe(1000);
    expect(weekResult(totals)).toBe(2398000);
  });

  it('settles exactly when everything held is sold at once', () => {
    const before = totalsOf([...bought, sell(3000, 165)]);
    const sellAll = unsold(before) * 165 - heldCost(before);
    expect(sellAll).toBe(485800);
    expect(madeSoFar(before) + sellAll).toBe(
      weekResult(totalsOf([...bought, sell(3000, 165), sell(7000, 165)])),
    );
  });

  it('rounds the cost of turnips to whole bells without drifting', () => {
    // 3,020 bells for 30 turnips: 100.67 each.
    const totals = totalsOf([buy(10, 100), buy(20, 101), sell(10, 120)]);
    expect(costOf(totals, 10)).toBe(1007);
    expect(madeSoFar(totals)).toBe(193);
    expect(heldCost(totals)).toBe(2013);
    expect(madeSoFar(totals) + unsold(totals) * 120 - heldCost(totals)).toBe(580);
  });

  it('has no averages or profit before anything is traded', () => {
    expect(averageCost(NO_TRADES)).toBeNull();
    expect(averageSale(NO_TRADES)).toBeNull();
    expect(costOf(NO_TRADES, 10)).toBe(0);
    expect(madeSoFar(NO_TRADES)).toBe(0);
    expect(weekResult(NO_TRADES)).toBe(0);
  });

  it("adds every finished week's result to this week's profit so far", () => {
    const weeks = [
      { weekStart: '2026-08-30', bought: 10000, spent: 998000, sold: 10000, earned: 2898000 },
      { weekStart: '2026-09-13', bought: 3000, spent: 321000, sold: 3000, earned: 264000 },
      { weekStart: '2026-09-20', bought: 8000, spent: 752000, sold: 8000, earned: 2896000 },
      // 1,000 turnips rotted.
      { weekStart: '2026-09-27', bought: 5000, spent: 505000, sold: 4000, earned: 528000 },
      // This week: 7,000 still held.
      { weekStart: '2026-10-04', bought: 10000, spent: 956000, sold: 3000, earned: 495000 },
    ];
    expect(overallProfit(weeks, '2026-10-04')).toBe(4218200);
    // Once this week ends, its unsold turnips count as rotted.
    expect(overallProfit(weeks, '2026-10-11')).toBe(4218200 - 208200 - 461000);
    // A week ahead of this device's clock doesn't count yet.
    expect(
      overallProfit(
        [...weeks, { weekStart: '2026-10-11', bought: 10, spent: 1000, sold: 0, earned: 0 }],
        '2026-10-04',
      ),
    ).toBe(4218200);
  });
});

describe('trade validation', () => {
  it('accepts purchases and sales that add up', () => {
    expect(tradesProblem([])).toBeNull();
    expect(tradesProblem([...bought, sell(3000, 142, 0), sell(7000, 660, 11)])).toBeNull();
    expect(tradesProblem([buy(100_000, 90), buy(10, 110), sell(10, 9)])).toBeNull();
  });

  it.each<[TradeProblem, Trade[]]>([
    ['quantity', [buy(15, 100)]],
    ['quantity', [buy(0, 100)]],
    ['quantity', [buy(10.5, 100)]],
    ['quantity', [buy(100_010, 100)]],
    ['price', [buy(10, 89)]],
    ['price', [buy(10, 111)]],
    ['price', [buy(10, 99.5)]],
    ['price', [buy(100, 100), sell(10, 8)]],
    ['price', [buy(100, 100), sell(10, 661)]],
    ['slot', [buy(100, 100), sell(10, 100, -1)]],
    ['slot', [buy(100, 100), sell(10, 100, 12)]],
    ['slot', [buy(100, 100), sell(10, 100, 1.5)]],
    ['oversold', [buy(100, 100), sell(110, 100)]],
    ['oversold', [sell(10, 100)]],
  ])('reports a %s problem', (problem, trades) => {
    expect(tradesProblem(trades)).toBe(problem);
  });

  it('caps a week at 40 entries with distinct IDs', () => {
    expect(tradesProblem(Array.from({ length: 40 }, () => buy(10, 100)))).toBeNull();
    expect(tradesProblem(Array.from({ length: 41 }, () => buy(10, 100)))).toBe('too-many');
    const repeated = buy(10, 100);
    expect(tradesProblem([repeated, { ...repeated }])).toBe('duplicate');
  });
});
