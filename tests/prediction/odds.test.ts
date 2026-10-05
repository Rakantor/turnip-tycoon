import { describe, expect, it } from 'vitest';
import { predictWeek } from '../../src/prediction';
import { combineChances, oddsAbove, slotChanceAbove } from '../../src/prediction/odds';
import { simulatedChanceAbove } from '../helpers/turnip-simulation';

const _ = null;
const week = (purchasePrice: number | null, ...entered: (number | null)[]) =>
  predictWeek({
    purchasePrice,
    prices: Array.from({ length: 12 }, (__, index) => entered[index] ?? null),
    firstBuy: false,
    previousPattern: null,
  });

// [description, purchase price, entered prices, first open half-day, price to beat]
const fixtures: [string, number | null, (number | null)[], number, number][] = [
  ['Sunday, nothing sold yet', 100, [], 0, 100],
  ['Monday PM after two drops', 100, [88, 84], 2, 84],
  ['a spike that has not started by Wednesday', 98, [86, 82, 78, 74, 70], 5, 200],
  ['fluctuating on Tuesday PM', 102, [118, 131, 72, 66], 4, 131],
  ['fluctuating on Thursday AM', 95, [100, 120, 130, 75, 68, 104, 122], 7, 122],
  ['fluctuating on Thursday PM', 95, [100, 120, 130, 75, 68, 104, 122, 128], 8, 128],
  ['an unknown purchase price', null, [95, 91], 2, 120],
  ['a friend with only Tuesday prices', 101, [_, _, 84, 80], 7, 141],
];

describe('odds of a higher price', () => {
  it.each(fixtures)(
    'agrees with a simulation of the game for %s',
    (_name, base, entered, fromSlot, price) => {
      const observed = Array.from({ length: 12 }, (__, index) => entered[index] ?? null);
      const odds = oddsAbove(week(base, ...entered), price, fromSlot);
      const simulated = simulatedChanceAbove(base, observed, fromSlot, price);
      expect(odds).not.toBeNull();
      expect(Math.abs((odds?.chance ?? 0) - simulated)).toBeLessThan(0.015);
    },
  );

  it('is certain when every remaining pattern spikes above the price', () => {
    // After three drops, 121 on Tuesday PM starts a large or small spike.
    const odds = oddsAbove(week(98, 86, 82, 78, 121), 121, 4);
    expect(odds).toMatchObject({ chance: 1, certain: true, impossible: false });
  });

  it('is impossible when no remaining half-day can reach the price', () => {
    const odds = oddsAbove(week(95, 100, 120, 130, 75, 68, 104, 122, 128), 133, 8);
    expect(odds).toMatchObject({ chance: 0, certain: false, impossible: true, driver: null });
    expect(odds?.bestCase).toBe(133);
  });

  it('names the pattern behind the chance', () => {
    const odds = oddsAbove(week(92, 82, 79, 75, 71, 68, 64, 61), 141, 7);
    expect(odds?.driver?.id).toBe('large-spike');
    expect(odds?.driver?.probability).toBeGreaterThan(0.1);
    expect(odds?.driver?.probability).toBeLessThan(0.3);
  });

  it('has no odds once every half-day has passed or without a forecast', () => {
    expect(oddsAbove(week(95, 100), 100, 12)).toBeNull();
    expect(oddsAbove(week(null), 100, 0)).toBeNull();
  });

  it('gives the chance for one unreported half-day', () => {
    const prediction = week(101, _, _, 84, 80);
    const thursdayPm = slotChanceAbove(prediction, 141, 7);
    expect(thursdayPm).toBeGreaterThan(0.3);
    expect(thursdayPm).toBeLessThan(oddsAbove(prediction, 141, 7)?.chance ?? 0);
  });

  it('combines independent islands', () => {
    expect(combineChances([])).toBe(0);
    expect(combineChances([0.5, 0.5])).toBeCloseTo(0.75, 12);
    expect(combineChances([0, 0.18, 0.21, 0.51])).toBeCloseTo(1 - 0.82 * 0.79 * 0.49, 12);
  });
});
