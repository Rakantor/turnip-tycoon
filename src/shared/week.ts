import type { Trade } from './ledger';

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

/** The owner's own week: everything friends see, plus the trades only the owner sees. */
export interface OwnWeekRecord extends WeekRecord {
  trades: Trade[];
}

export interface WeekMutation extends WeeklyInputs {
  mutationId: string;
  baseRevision: number;
  /** Replaces the week's trades. Left out, as by app versions before trades, they stay. */
  trades?: Trade[];
}

export function emptyWeek(playerId: string, weekStart: string): WeekRecord {
  return {
    playerId,
    weekStart,
    revision: 0,
    purchasePrice: null,
    // Most weeks are not an island's first Daisy Mae purchase; a saved choice still wins.
    firstBuy: false,
    previousPattern: null,
    prices: Array<number | null>(12).fill(null),
  };
}

export function emptyOwnWeek(playerId: string, weekStart: string): OwnWeekRecord {
  return { ...emptyWeek(playerId, weekStart), trades: [] };
}

export function inputsOf(week: WeeklyInputs): WeeklyInputs {
  return {
    purchasePrice: week.purchasePrice,
    firstBuy: week.firstBuy,
    previousPattern: week.previousPattern,
    prices: [...week.prices],
  };
}
