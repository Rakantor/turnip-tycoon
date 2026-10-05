import type { PatternId, PredictionResult, PriceRange } from './index';

export interface Odds {
  /** Chance, 0–1, of a price above the one given in any remaining half-day. */
  chance: number;
  /** Every outcome still possible has a higher price ahead. */
  certain: boolean;
  /** No outcome still possible has a higher price ahead. */
  impossible: boolean;
  /** The highest price still possible in the remaining half-days. */
  bestCase: number;
  /** The pattern behind most of the chance; null when a higher price is impossible. */
  driver: { id: PatternId; label: string; probability: number } | null;
}

/** Each whole-bell price in one outcome's range is equally likely. */
function chanceInRange({ min, max }: PriceRange, price: number): number {
  return Math.min(1, Math.max(0, (max - price) / (max - min + 1)));
}

/**
 * The chance of a price above `price` in any half-day from `fromSlot` through
 * Saturday PM. Within one outcome the game draws each half-day's rate independently,
 * so half-days are treated as independent and uniform over their ranges. Outcomes are
 * then weighted by their probability. tests/prediction/odds.test.ts checks the
 * result against a simulation of the game's own price rules.
 */
export function oddsAbove(
  prediction: PredictionResult,
  price: number,
  fromSlot: number,
): Odds | null {
  if (prediction.status !== 'possible' || fromSlot > 11) return null;
  let chance = 0;
  let certain = true;
  let impossible = true;
  let bestCase = 0;
  const byPattern = new Map<PatternId, number>();
  for (const outcome of prediction.outcomes) {
    let stayAtOrBelow = 1;
    let sure = false;
    for (let slot = Math.max(0, fromSlot); slot < 12; slot++) {
      const range = outcome.slots[slot];
      stayAtOrBelow *= 1 - chanceInRange(range, price);
      if (range.min > price) sure = true;
      bestCase = Math.max(bestCase, range.max);
    }
    const share = outcome.probability * (1 - stayAtOrBelow);
    chance += share;
    byPattern.set(outcome.pattern, (byPattern.get(outcome.pattern) ?? 0) + share);
    certain &&= sure;
    impossible &&= stayAtOrBelow === 1;
  }
  let driver: Odds['driver'] = null;
  if (!impossible) {
    const [id] = [...byPattern].reduce((top, entry) => (entry[1] > top[1] ? entry : top));
    driver = prediction.patterns.find((pattern) => pattern.id === id) ?? null;
  }
  return {
    // Floating-point sums can land a hair away from the exact answer.
    chance: certain ? 1 : impossible ? 0 : Math.min(1, Math.max(0, chance)),
    certain,
    impossible,
    bestCase,
    driver,
  };
}

/** The chance that one half-day's price, not yet reported, is above `price`. */
export function slotChanceAbove(prediction: PredictionResult, price: number, slot: number): number {
  if (prediction.status !== 'possible') return 0;
  return prediction.outcomes.reduce(
    (sum, outcome) => sum + outcome.probability * chanceInRange(outcome.slots[slot], price),
    0,
  );
}

/** Islands are independent: nobody beats a price only if each island fails to. */
export function combineChances(chances: number[]): number {
  return 1 - chances.reduce((none, chance) => none * (1 - chance), 1);
}
