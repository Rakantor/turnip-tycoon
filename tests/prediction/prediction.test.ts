import { describe, expect, it } from 'vitest';
import { predictWeek, type PatternId, type PredictionInput } from '../../src/prediction';
import { Predictor } from '../../src/prediction/vendor/predictions.js';

const emptyPrices = (): (number | null)[] => Array.from({ length: 12 }, () => null);
const input = (overrides: Partial<PredictionInput> = {}): PredictionInput => ({
  purchasePrice: 100,
  prices: emptyPrices(),
  firstBuy: false,
  previousPattern: null,
  ...overrides,
});

// Independently chosen rates from Ninji's documented generation rules, not
// observations sampled from the predictor under test. Base is 100 throughout.
// https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b
const examples: { pattern: PatternId; prices: number[] }[] = [
  // Seven high samples in [0.9,1.4], separated by 2/3 lows falling by 0.06.
  { pattern: 'fluctuating', prices: [100, 110, 70, 64, 120, 130, 115, 75, 69, 63, 105, 125] },
  // Three declining values, five independent spike rates, four random lows.
  { pattern: 'large-spike', prices: [90, 86, 82, 110, 180, 450, 180, 110, 60, 55, 50, 45] },
  // Initial rate 0.9 and a 0.04 decay in each of the eleven following slots.
  { pattern: 'decreasing', prices: [90, 86, 82, 78, 74, 70, 66, 62, 58, 54, 50, 46] },
  // Peak rate 1.8; side rates 1.51/1.61 have one bell subtracted; 0.04 declines.
  { pattern: 'small-spike', prices: [70, 66, 62, 100, 110, 150, 180, 160, 70, 66, 62, 58] },
];

describe('Turnip Prophet adapter', () => {
  it.each(examples)('identifies an independent $pattern week', ({ pattern, prices }) => {
    const result = predictWeek(input({ prices }));
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(0);
    expect(result.patterns).toEqual([{ id: pattern, label: expect.any(String), probability: 1 }]);
    expect(result.slots).toEqual(prices.map((price) => ({ min: price, max: price })));
  });

  it('starts with no forecast until a price is supplied', () => {
    expect(predictWeek(input({ purchasePrice: null })).status).toBe('needs-input');
  });

  it('uses the documented stationary prior when the previous pattern is unknown', () => {
    const result = predictWeek(input());
    const priors = {
      fluctuating: 4530 / 13082,
      'large-spike': 3236 / 13082,
      decreasing: 1931 / 13082,
      'small-spike': 3385 / 13082,
    };
    expect(result.slots).toHaveLength(12);
    expect(result.patterns).toHaveLength(4);
    for (const pattern of result.patterns)
      expect(pattern.probability).toBeCloseTo(priors[pattern.id], 12);
    expect(result.patterns.reduce((sum, pattern) => sum + pattern.probability, 0)).toBeCloseTo(
      1,
      12,
    );
  });

  it('uses the previous-week transition matrix when explicitly supplied', () => {
    const result = predictWeek(input({ previousPattern: 'decreasing' }));
    const expected = {
      fluctuating: 0.25,
      'large-spike': 0.45,
      decreasing: 0.05,
      'small-spike': 0.25,
    };
    for (const pattern of result.patterns)
      expect(pattern.probability).toBeCloseTo(expected[pattern.id], 12);
  });

  it('retains the pinned upstream conditional probabilities for a mixed forecast', () => {
    // Captured by running the unmodified pinned upstream file independently.
    // This guards adapter aggregation/normalization and our range-only fixes.
    const result = predictWeek(input({ prices: [90, 85, ...emptyPrices().slice(2)] }));
    const expected = {
      'large-spike': 0.559375686489173,
      decreasing: 0.389425275766077,
      'small-spike': 0.05119903774475029,
    };
    expect(result.patterns).toHaveLength(3);
    for (const pattern of result.patterns) {
      expect(pattern.probability).toBeCloseTo(expected[pattern.id as keyof typeof expected], 12);
    }
  });

  it.each(examples)(
    'keeps an independent $pattern fixture in range with missing slots',
    ({ prices }) => {
      const partial = prices.map((price, index) => (index % 3 === 0 ? price : null));
      const result = predictWeek(input({ prices: partial }));
      expect(result.status).toBe('possible');
      expect(result.tolerance).toBe(0);
      for (const [index, range] of result.slots.entries()) {
        expect(prices[index]).toBeGreaterThanOrEqual(range.min);
        expect(prices[index]).toBeLessThanOrEqual(range.max);
      }
    },
  );

  it('calculates from partial observations with an unknown Sunday price', () => {
    const prices = emptyPrices();
    prices[5] = 450;
    const result = predictWeek(input({ purchasePrice: null, prices }));
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(0);
    expect(result.patterns[0].id).toBe('large-spike');
    expect(result.patterns[0].probability).toBeCloseTo(1);
    expect(result.slots[5]).toEqual({ min: 450, max: 450 });
    expect(result.slots).toHaveLength(12);
  });

  it('uses the first island purchase model and its hidden base price', () => {
    const first = predictWeek(input({ firstBuy: true }));
    const differentDisplayPrice = predictWeek(input({ firstBuy: true, purchasePrice: 110 }));
    expect(first.patterns).toEqual([
      { id: 'small-spike', label: 'Small spike', probability: expect.closeTo(1, 12) },
    ]);
    expect(first).toEqual(differentDisplayPrice);
    expect(
      first.slots.every((slot) => Number.isFinite(slot.min) && Number.isFinite(slot.max)),
    ).toBe(true);
  });

  it('keeps the general four-pattern model when first buying is unknown', () => {
    expect(predictWeek(input({ firstBuy: null }))).toEqual(predictWeek(input({ firstBuy: false })));
  });

  it('reproduces #600 as a first-buy input mismatch for its published observations', () => {
    const prices = [91, 86, 83, 79, 74, 70, 67, 103, 162, null, null, null];
    const values = input({ purchasePrice: 105, prices });
    expect(predictWeek({ ...values, firstBuy: true }).status).toBe('inconsistent');
    const result = predictWeek({ ...values, firstBuy: false });
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(0);
    expect(result.patterns[0].id).toBe('large-spike');
  });

  it('reports upstream numerical tolerance without rewriting entered values', () => {
    const prices = [91, 86, 82, 78, 74, 70, 66, 62, 58, 54, 50, 46];
    const result = predictWeek(input({ prices }));
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(1);
    expect(result.slots.map((slot) => slot.min)).toEqual(prices);
  });

  it('reports contradictions while preserving every observation', () => {
    const values = input({ prices: [999, ...emptyPrices().slice(1)] });
    const saved = structuredClone(values);
    expect(predictWeek(values)).toEqual({
      status: 'inconsistent',
      patterns: [],
      slots: [],
      tolerance: 0,
    });
    expect(values).toEqual(saved);
  });

  it.each([0, -1, 1.5, 89, 111, Number.NaN, Number.POSITIVE_INFINITY, 1000])(
    'rejects invalid price %s',
    (price) => {
      expect(predictWeek(input({ purchasePrice: price })).status).toBe('inconsistent');
    },
  );

  it('requires all twelve selling slots, with null for missing observations', () => {
    expect(predictWeek(input({ prices: [100] })).status).toBe('inconsistent');
  });

  it('preserves the upstream rounding threshold near integer boundaries', () => {
    const predictor = new Predictor([], false, null);
    expect(predictor.intceil(138.6)).toBe(139);
    expect(predictor.intceil(140)).toBe(140);
    expect(predictor.intceil(140.000001)).toBe(140);
    expect(predictor.intceil(140.00002)).toBe(141);
  });

  it('does not carry observations between predictions or weeks (#616 boundary)', () => {
    const first = predictWeek(input({ prices: examples[0].prices }));
    expect(predictWeek(input()).patterns).toHaveLength(4);
    expect(predictWeek(input({ prices: examples[0].prices }))).toEqual(first);
  });
});

describe('reported small-spike range regressions', () => {
  it('never inverts inferred ranges when upstream accepts a low center with tolerance', () => {
    const result = predictWeek(
      input({
        purchasePrice: 99,
        previousPattern: 'small-spike',
        prices: [65, 110, null, null, 138, null, null, null, null, null, null, null],
      }),
    );
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(1);
    expect(result.slots[4]).toEqual({ min: 138, max: 138 });
    expect(result.slots.every((range) => range.min <= range.max)).toBe(true);
  });

  it('raises the possible center above an observed right shoulder', () => {
    const result = predictWeek(
      input({
        purchasePrice: 99,
        previousPattern: 'small-spike',
        prices: [65, 110, null, null, null, 175, null, null, null, null, null, null],
      }),
    );
    expect(result.status).toBe('possible');
    expect(result.tolerance).toBe(0);
    expect(result.slots[4]).toEqual({ min: 176, max: 198 });
  });

  it('keeps the center above its shoulders (#369 / #376)', () => {
    const result = predictWeek(
      input({
        purchasePrice: 99,
        previousPattern: 'small-spike',
        prices: [65, 110, ...emptyPrices().slice(2)],
      }),
    );
    expect(result.status).toBe('possible');
    expect(result.patterns.map((pattern) => pattern.id)).toEqual(['small-spike']);
    // Center = ceil(rate * 99), rate >= 1.4: ceil(138.6) = 139.
    expect(result.slots[4]).toEqual({ min: 139, max: 198 });
  });

  it('narrows both shoulders when a later center is known (#367)', () => {
    const prices = [66, 62, 58, 53, 103, 147, null, null, null, null, null, null];
    const before = predictWeek(
      input({ purchasePrice: 108, previousPattern: 'large-spike', prices }),
    );
    prices[7] = 153;
    const after = predictWeek(
      input({ purchasePrice: 108, previousPattern: 'large-spike', prices }),
    );
    expect(after.status).toBe('possible');
    // Side = ceil(sideRate * 108) - 1, 1.4 <= sideRate <= centerRate.
    expect(after.slots[6]).toEqual({ min: 151, max: 152 });
    expect(after.slots[8]).toEqual({ min: 151, max: 152 });
    expect(after.slots[6].max).toBeLessThan(before.slots[6].max);
  });
});
