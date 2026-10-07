import { describe, expect, it } from 'vitest';
import type { PatternId, PredictionResult } from '../../src/prediction';
import { percent, slotName, weekAdvice } from '../../src/client/advice';

const prices = (...entered: (number | null)[]): (number | null)[] =>
  Array.from({ length: 12 }, (_, index) => entered[index] ?? null);

function possible(
  patterns: [PatternId, number][],
  slots: [number, number][] = Array.from({ length: 12 }, () => [60, 140]),
): PredictionResult {
  const ranges = slots.map(([min, max]) => ({ min, max }));
  return {
    status: 'possible',
    patterns: patterns.map(([id, probability]) => ({ id, label: id, probability })),
    slots: ranges,
    // Each pattern stands in for one outcome spanning the whole summarized range.
    outcomes: patterns.map(([pattern, probability]) => ({ pattern, probability, slots: ranges })),
    tolerance: 0,
  };
}

// A large-spike week after Monday–Tuesday PM, peaking on Wednesday afternoon.
const spikeSlots: [number, number][] = [
  [86, 86],
  [82, 82],
  [78, 78],
  [121, 121],
  [89, 196],
  [137, 588],
  [138, 196],
  [89, 195],
  [40, 89],
  [35, 89],
  [30, 89],
  [25, 89],
];

describe('week advice', () => {
  it('names half-days in plain language', () => {
    expect(slotName(0)).toBe('Monday morning');
    expect(slotName(11)).toBe('Saturday afternoon');
    expect(percent(0.916)).toBe('92%');
    expect(percent(0.001)).toBe('<1%');
  });

  it('asks for a first price before forecasting', () => {
    const advice = weekAdvice({
      prediction: { status: 'needs-input', patterns: [], slots: [], outcomes: [], tolerance: 0 },
      prices: prices(),
      purchasePrice: null,
      slot: null,
      isCurrent: true,
    });
    expect(advice.lead).toMatch(/Daisy Mae/);
    expect(advice.highlight).toBe('');
    expect(advice.bestSlot).toBeNull();
  });

  it('points to the highest possible upcoming price during a likely spike', () => {
    const advice = weekAdvice({
      prediction: possible(
        [
          ['large-spike', 0.916],
          ['small-spike', 0.084],
        ],
        spikeSlots,
      ),
      prices: prices(86, 82, 78, 121),
      purchasePrice: 98,
      slot: 3,
      isCurrent: true,
    });
    expect(advice.eyebrow).toBe('Tuesday afternoon forecast');
    expect(advice.lead).toMatch(/big spike is coming/);
    expect(advice.highlight).toBe('up to 588 bells');
    expect(advice.trail).toBe(' on Wednesday afternoon.');
    expect(advice.bestSlot).toBe(5);
    expect(advice.chips.map(({ text }) => text)).toEqual([
      '92% large-spike',
      'Even the low end, 137, beats what you paid',
    ]);
  });

  it('adds the odds of beating the current price after the pattern', () => {
    const advise = (odds: { price: number; chance: number; certain: boolean }) =>
      weekAdvice({
        prediction: possible([['fluctuating', 1]]),
        prices: prices(100, 120, 130, 75, 68, 104, 122, 128),
        purchasePrice: 95,
        slot: 7,
        isCurrent: true,
        odds,
      }).chips.map(({ text }) => text);
    expect(advise({ price: 128, chance: 0.104, certain: false })[1]).toBe(
      '10% chance of more than 128',
    );
    expect(advise({ price: 128, chance: 0.997, certain: false })[1]).toBe(
      '>99% chance of more than 128',
    );
    expect(advise({ price: 121, chance: 1, certain: true })[1]).toBe('A higher price is coming');
    expect(advise({ price: 133, chance: 0, certain: false })).not.toContainEqual(
      expect.stringMatching(/chance of more/),
    );
  });

  it('ignores past half-days when looking for the peak', () => {
    const slots = spikeSlots.map((range, index): [number, number] =>
      index === 1 ? [82, 900] : range,
    );
    const advice = weekAdvice({
      prediction: possible([['large-spike', 1]], slots),
      prices: prices(86, null, 78, 121),
      purchasePrice: 98,
      slot: 3,
      isCurrent: true,
    });
    expect(advice.highlight).toBe('up to 588 bells');
  });

  it('recommends selling when the current price beats everything still possible', () => {
    const slots = spikeSlots.map((range, index): [number, number] =>
      index === 5 ? [560, 560] : index > 5 ? [40, 200] : range,
    );
    const advice = weekAdvice({
      prediction: possible([['large-spike', 1]], slots),
      prices: prices(86, 82, 78, 121, 180, 560),
      purchasePrice: 98,
      slot: 5,
      isCurrent: true,
    });
    expect(advice.highlight).toBe('560 bells');
    expect(advice.trail).toMatch(/Time to sell/);
    expect(advice.bestSlot).toBe(5);
    expect(advice.chips[1]).toEqual({ text: '5.7× what you paid', tone: 'gold' });
  });

  it('suggests selling soon during a confident decline without marking a best day', () => {
    const advice = weekAdvice({
      prediction: possible([
        ['decreasing', 0.8],
        ['large-spike', 0.2],
      ]),
      prices: prices(88, 84),
      purchasePrice: 100,
      slot: 2,
      isCurrent: true,
    });
    expect(advice.highlight).toBe('selling soon');
    expect(advice.bestSlot).toBeNull();
  });

  it('stays cautious when no pattern is clearly ahead', () => {
    const advice = weekAdvice({
      prediction: possible(
        [
          ['fluctuating', 0.4],
          ['decreasing', 0.35],
          ['small-spike', 0.25],
        ],
        Array.from({ length: 12 }, (_, index) => (index === 6 ? [60, 180] : [60, 140])),
      ),
      prices: prices(),
      purchasePrice: 100,
      slot: null,
      isCurrent: true,
    });
    expect(advice.eyebrow).toBe('Sunday forecast');
    expect(advice.lead).toMatch(/too early to call/);
    expect(advice.trail).toBe(' on Thursday morning.');
    expect(advice.bestSlot).toBe(6);
    expect(advice.chips[1].text).toBe('Could be as low as 60 then');
  });

  it('names a window instead of one half-day when several share the peak', () => {
    const slots: [number, number][] = Array.from({ length: 12 }, (_, index) =>
      index >= 3 && index <= 9 ? [25, 588] : [40, 196],
    );
    const advice = weekAdvice({
      prediction: possible(
        [
          ['fluctuating', 0.35],
          ['small-spike', 0.26],
          ['large-spike', 0.25],
          ['decreasing', 0.14],
        ],
        slots,
      ),
      prices: prices(),
      purchasePrice: 98,
      slot: null,
      isCurrent: true,
    });
    expect(advice.highlight).toBe('up to 588 bells');
    expect(advice.trail).toBe(' between Tuesday afternoon and Friday afternoon.');
    expect(advice.bestSlot).toBeNull();
    expect(advice.chips[1].text).toBe('Peak day still open');
  });

  it('wraps up the week once every price is in', () => {
    const advice = weekAdvice({
      prediction: possible([['decreasing', 1]]),
      prices: prices(90, 86, 82, 78, 74, 70, 66, 62, 58, 54, 50, 46),
      purchasePrice: 100,
      slot: 11,
      isCurrent: true,
    });
    expect(advice.lead).toMatch(/Every price this week is in/);
    expect(advice.bestSlot).toBeNull();
  });

  it('summarizes past weeks with the best entered price', () => {
    const advice = weekAdvice({
      prediction: possible([['small-spike', 0.7]]),
      prices: prices(70, 66, 62, 100, 110, 150, 180),
      purchasePrice: 99,
      slot: null,
      isCurrent: false,
    });
    expect(advice.eyebrow).toBe('Looking back');
    expect(advice.highlight).toBe('180 bells');
    expect(advice.trail).toBe(' on Thursday morning.');
    expect(advice.bestSlot).toBe(6);
  });

  it('states a certain past pattern plainly', () => {
    const certain = weekAdvice({
      prediction: possible([['fluctuating', 1]]),
      prices: prices(104, 112, 78, 73, 118, 125, 132),
      purchasePrice: 101,
      slot: null,
      isCurrent: false,
    });
    expect(certain.lead).toBe('This was a fluctuating week. Your best price was ');
    const likely = weekAdvice({
      prediction: possible([
        ['fluctuating', 0.9],
        ['small-spike', 0.1],
      ]),
      prices: prices(104),
      purchasePrice: 101,
      slot: null,
      isCurrent: false,
    });
    expect(likely.lead).toBe('This was most likely a fluctuating week (90%). Your best price was ');
  });
});
