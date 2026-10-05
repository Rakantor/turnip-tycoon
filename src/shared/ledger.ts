import { PURCHASE_PRICE_RANGE, SELLING_PRICE_RANGE } from './week';

/** Turnips change hands in bunches of 10. */
export const TRADE_BUNCH = 10;
/** One logged purchase or sale holds at most this many turnips. */
export const TRADE_QUANTITY_MAX = 100_000;
/** A week holds at most this many purchases and sales together. */
export const TRADES_PER_WEEK_MAX = 40;

/**
 * One purchase or sale a player logs for a week, in bells per turnip. Purchases
 * are always Sunday's; a sale records its half-day, 0 (Monday AM) to 11 (Saturday PM).
 */
export type Trade =
  | { id: string; kind: 'buy'; quantity: number; price: number }
  | { id: string; kind: 'sell'; quantity: number; price: number; slot: number };

/** What a week's trades add up to, in turnips and bells. */
export interface LedgerTotals {
  bought: number;
  spent: number;
  sold: number;
  earned: number;
}

export const NO_TRADES: LedgerTotals = { bought: 0, spent: 0, sold: 0, earned: 0 };

export type TradeProblem = 'too-many' | 'duplicate' | 'quantity' | 'price' | 'slot' | 'oversold';

/** Why a week's trades cannot be saved, or null when they can. The app and API both check. */
export function tradesProblem(trades: readonly Trade[]): TradeProblem | null {
  if (trades.length > TRADES_PER_WEEK_MAX) return 'too-many';
  const ids = new Set<string>();
  for (const trade of trades) {
    if (ids.has(trade.id)) return 'duplicate';
    ids.add(trade.id);
    if (
      !Number.isInteger(trade.quantity) ||
      trade.quantity < TRADE_BUNCH ||
      trade.quantity > TRADE_QUANTITY_MAX ||
      trade.quantity % TRADE_BUNCH
    )
      return 'quantity';
    const range = trade.kind === 'buy' ? PURCHASE_PRICE_RANGE : SELLING_PRICE_RANGE;
    if (!Number.isInteger(trade.price) || trade.price < range.min || trade.price > range.max)
      return 'price';
    if (
      trade.kind === 'sell' &&
      !(Number.isInteger(trade.slot) && trade.slot >= 0 && trade.slot < 12)
    )
      return 'slot';
  }
  const totals = totalsOf(trades);
  return totals.sold > totals.bought ? 'oversold' : null;
}

export function totalsOf(trades: readonly Trade[]): LedgerTotals {
  const totals = { ...NO_TRADES };
  for (const trade of trades) {
    if (trade.kind === 'buy') {
      totals.bought += trade.quantity;
      totals.spent += trade.quantity * trade.price;
    } else {
      totals.sold += trade.quantity;
      totals.earned += trade.quantity * trade.price;
    }
  }
  return totals;
}

/** Turnips bought but not sold: held during the week, rotten once it ends. */
export function unsold(totals: LedgerTotals): number {
  return Math.max(0, totals.bought - totals.sold);
}

/** Average bells paid per turnip, unrounded, or null before any purchase. */
export function averageCost(totals: LedgerTotals): number | null {
  return totals.bought ? totals.spent / totals.bought : null;
}

/** Average bells received per turnip, unrounded, or null before any sale. */
export function averageSale(totals: LedgerTotals): number | null {
  return totals.sold ? totals.earned / totals.sold : null;
}

/**
 * Every turnip in a week rots at the same time, so purchases pool at their
 * average cost. This is what `quantity` of them cost, in whole bells.
 */
export function costOf(totals: LedgerTotals, quantity: number): number {
  return totals.bought ? Math.round((quantity * totals.spent) / totals.bought) : 0;
}

/** What the turnips still held cost; selling them all at once settles the week exactly. */
export function heldCost(totals: LedgerTotals): number {
  return totals.spent - costOf(totals, totals.sold);
}

/** Profit on what has been sold so far; turnips still held don't count yet. */
export function madeSoFar(totals: LedgerTotals): number {
  return totals.earned - costOf(totals, totals.sold);
}

/** A finished week's result. Unsold turnips rotted, so they count at what they cost. */
export function weekResult(totals: LedgerTotals): number {
  return totals.earned - totals.spent;
}

/** Every finished week's result plus this week's profit so far. */
export function overallProfit(
  weeks: readonly (LedgerTotals & { weekStart: string })[],
  currentWeek: string,
): number {
  let profit = 0;
  for (const week of weeks) {
    if (week.weekStart < currentWeek) profit += weekResult(week);
    else if (week.weekStart === currentWeek) profit += madeSoFar(week);
    // A week ahead of this device's clock, saved from another device, counts once it starts here.
  }
  return profit;
}
