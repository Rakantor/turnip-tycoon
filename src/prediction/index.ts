import { Predictor } from './vendor/predictions.js';

export const ENGINE_REVISION = 'c7b7ab3614faf61686da3c535cf204ef568d4cdb';

export type PatternId = 'fluctuating' | 'large-spike' | 'decreasing' | 'small-spike';

export interface PredictionInput {
  /** Daisy Mae's price on this island; null if unknown. */
  purchasePrice: number | null;
  /** Monday AM through Saturday PM, exactly twelve entries. */
  prices: (number | null)[];
  /** First purchase from Daisy Mae on this island, not first use of this app. */
  firstBuy: boolean | null;
  previousPattern: PatternId | null;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface PredictionResult {
  status: 'needs-input' | 'possible' | 'inconsistent';
  patterns: { id: PatternId; label: string; probability: number }[];
  /** Twelve ranges when possible; empty when no forecast can be made. */
  slots: PriceRange[];
  /** Upstream's numeric tolerance, in bells; never modifies the input. */
  tolerance: number;
}

const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'fluctuating', label: 'Fluctuating' },
  { id: 'large-spike', label: 'Large spike' },
  { id: 'decreasing', label: 'Decreasing' },
  { id: 'small-spike', label: 'Small spike' },
];

function validPrice(price: number | null): boolean {
  return price === null || (Number.isInteger(price) && price > 0 && price <= 999);
}

/**
 * Browser/storage independent adapter around Turnip Prophet's real engine.
 * Unknown first-buy status uses upstream's general four-pattern model; selecting
 * true switches to the first-purchase model, whose hidden base price is unknown.
 * Unknown previous pattern uses upstream's stationary transition probabilities.
 */
export function predictWeek(input: PredictionInput): PredictionResult {
  const empty = (status: 'needs-input' | 'inconsistent'): PredictionResult => ({
    status,
    patterns: [],
    slots: [],
    tolerance: 0,
  });

  if (
    input.prices.length !== 12 ||
    !validPrice(input.purchasePrice) ||
    (input.purchasePrice !== null && (input.purchasePrice < 90 || input.purchasePrice > 110)) ||
    !input.prices.every(validPrice) ||
    (input.previousPattern !== null &&
      !PATTERNS.some((pattern) => pattern.id === input.previousPattern)) ||
    (input.firstBuy !== null && typeof input.firstBuy !== 'boolean')
  ) {
    return empty('inconsistent');
  }

  if (input.purchasePrice === null && input.prices.every((price) => price === null)) {
    return empty('needs-input');
  }

  // The source engine expects two Sunday entries followed by the twelve sales.
  // NaN is its missing-value sentinel. Build a new array to preserve observations.
  const prices = [input.purchasePrice, input.purchasePrice, ...input.prices].map(
    (price) => price ?? Number.NaN,
  );
  const previous =
    input.previousPattern === null
      ? null
      : PATTERNS.findIndex((pattern) => pattern.id === input.previousPattern);
  const predictor = new Predictor(prices, input.firstBuy === true, previous);
  const outcomes = predictor.analyze_possibilities();
  const possibilities = outcomes.filter(
    (outcome) =>
      outcome.pattern_number < 4 &&
      Number.isFinite(outcome.probability) &&
      (outcome.probability ?? 0) > 0,
  );
  if (possibilities.length === 0) return empty('inconsistent');

  const patterns = PATTERNS.map((pattern, index) => ({
    ...pattern,
    probability: possibilities
      .filter((outcome) => outcome.pattern_number === index)
      .reduce((sum, outcome) => sum + (outcome.probability ?? 0), 0),
  }))
    .filter((pattern) => pattern.probability > 0)
    .sort((left, right) => right.probability - left.probability);

  const slots = Array.from({ length: 12 }, (_, index) => ({
    min: Math.min(...possibilities.map((outcome) => outcome.prices[index + 2].min)),
    max: Math.max(...possibilities.map((outcome) => outcome.prices[index + 2].max)),
  }));

  return { status: 'possible', patterns, slots, tolerance: predictor.fudge_factor };
}
