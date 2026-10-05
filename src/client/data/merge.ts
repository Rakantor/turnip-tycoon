import { tradesProblem, type Trade } from '../../shared/ledger';
import type { OwnWeekRecord } from '../../shared/week';

/**
 * One thing a player enters: a week setting, a half-day's price, or one trade.
 * `trades` stands for the whole list when combined trades no longer add up.
 */
export type WeekEntry =
  | 'purchasePrice'
  | 'firstBuy'
  | 'previousPattern'
  | 'trades'
  | `price:${number}`
  | `trade:${string}`;

function sameTrade(left: Trade | undefined, right: Trade | undefined): boolean {
  if (!left || !right) return left === right;
  return (
    left.kind === right.kind &&
    left.quantity === right.quantity &&
    left.price === right.price &&
    (left.kind === 'buy' || (right.kind === 'sell' && left.slot === right.slot))
  );
}

export function sameTrades(left: readonly Trade[], right: readonly Trade[]): boolean {
  return (
    left.length === right.length &&
    left.every((trade, index) => trade.id === right[index].id && sameTrade(trade, right[index]))
  );
}

/** Whether two versions hold the same entries, whatever their revisions. */
export function sameEntries(left: OwnWeekRecord, right: OwnWeekRecord): boolean {
  return (
    left.purchasePrice === right.purchasePrice &&
    left.firstBuy === right.firstBuy &&
    left.previousPattern === right.previousPattern &&
    left.prices.every((price, slot) => price === right.prices[slot]) &&
    sameTrades(left.trades, right.trades)
  );
}

/**
 * Combines this device's edits with another device's, entry by entry, against the
 * version both started from. An entry only one device changed takes that change; only
 * an entry both changed differently is a conflict, where the preferred side wins.
 */
export function mergeWeek(
  base: OwnWeekRecord,
  local: OwnWeekRecord,
  remote: OwnWeekRecord,
  prefer: 'local' | 'remote',
): { week: OwnWeekRecord; conflicts: WeekEntry[] } {
  const conflicts: WeekEntry[] = [];
  function choose<T>(
    entry: WeekEntry,
    ours: T,
    theirs: T,
    original: T,
    same: (left: T, right: T) => boolean = Object.is,
    found = conflicts,
    side = prefer,
  ): T {
    if (same(ours, theirs) || same(theirs, original)) return ours;
    if (same(ours, original)) return theirs;
    found.push(entry);
    return side === 'local' ? ours : theirs;
  }

  const week: OwnWeekRecord = {
    ...remote,
    purchasePrice: choose(
      'purchasePrice',
      local.purchasePrice,
      remote.purchasePrice,
      base.purchasePrice,
    ),
    firstBuy: choose('firstBuy', local.firstBuy, remote.firstBuy, base.firstBuy),
    previousPattern: choose(
      'previousPattern',
      local.previousPattern,
      remote.previousPattern,
      base.previousPattern,
    ),
    prices: remote.prices.map((_, slot) =>
      choose(`price:${slot}`, local.prices[slot], remote.prices[slot], base.prices[slot]),
    ),
  };

  const byId = (trades: readonly Trade[]) => new Map(trades.map((trade) => [trade.id, trade]));
  const [original, ours, theirs] = [base, local, remote].map((version) => byId(version.trades));
  // This device's order first, then trades only the other device has.
  const ids = [...new Set([...local.trades, ...remote.trades].map((trade) => trade.id))];
  const tradesFor = (side: 'local' | 'remote', found: WeekEntry[]) =>
    ids.flatMap((id) => {
      const trade = choose<Trade | undefined>(
        `trade:${id}`,
        ours.get(id),
        theirs.get(id),
        original.get(id),
        sameTrade,
        found,
        side,
      );
      return trade ? [trade] : [];
    });
  const tradeConflicts: WeekEntry[] = [];
  const preferred = tradesFor(prefer, tradeConflicts);
  const other = tradesFor(prefer === 'local' ? 'remote' : 'local', []);
  if (tradesProblem(preferred) || tradesProblem(other)) {
    // Combined, the trades no longer add up, so the whole list is one choice.
    week.trades = choose('trades', local.trades, remote.trades, base.trades, sameTrades);
  } else {
    week.trades = preferred;
    conflicts.push(...tradeConflicts);
  }
  return { week, conflicts };
}
