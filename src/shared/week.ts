export type PatternId = 'fluctuating' | 'large-spike' | 'decreasing' | 'small-spike';

/** Daisy Mae's Sunday purchase price, in bells, inclusive. */
export const PURCHASE_PRICE_RANGE = { min: 90, max: 110 } as const;
/** Nook's Cranny selling price, in bells, inclusive. */
export const SELLING_PRICE_RANGE = { min: 9, max: 660 } as const;

export interface WeeklyInputs {
  purchasePrice: number | null;
  firstBuy: boolean | null;
  previousPattern: PatternId | null;
  /** Monday AM, Monday PM, …, Saturday PM. Null means unknown. */
  prices: (number | null)[];
}

export interface WeekRecord extends WeeklyInputs {
  playerId: string;
  weekStart: string;
  revision: number;
}

export interface WeekMutation extends WeeklyInputs {
  mutationId: string;
  baseRevision: number;
}

export function emptyWeek(playerId: string, weekStart: string): WeekRecord {
  return {
    playerId,
    weekStart,
    revision: 0,
    purchasePrice: null,
    firstBuy: null,
    previousPattern: null,
    prices: Array<number | null>(12).fill(null),
  };
}

export function inputsOf(week: WeeklyInputs): WeeklyInputs {
  return {
    purchasePrice: week.purchasePrice,
    firstBuy: week.firstBuy,
    previousPattern: week.previousPattern,
    prices: [...week.prices],
  };
}
