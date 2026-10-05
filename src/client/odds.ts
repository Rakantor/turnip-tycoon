import type { PredictionResult } from '../prediction';
import { combineChances, oddsAbove, slotChanceAbove, type Odds } from '../prediction/odds';
import type { SharedPlayerWeek } from '../shared/groups';
import type { WeeklyInputs } from '../shared/week';
import { percent } from './advice';

export type ForecastMember = SharedPlayerWeek & { prediction: PredictionResult };

export interface IslandOdds {
  /** The price to beat: this half-day's, or on Sunday what was paid. Null until entered. */
  price: number | null;
  /** The first half-day still open; 12 when none are left. */
  fromSlot: number;
  odds: Odds | null;
}

/** Your island's odds of beating the price you can get right now. */
export function islandOdds(
  week: WeeklyInputs,
  prediction: PredictionResult,
  slot: number | null,
): IslandOdds {
  const price = slot === null ? week.purchasePrice : week.prices[slot];
  // An unreported half-day is still open; once reported, the odds look past it.
  const fromSlot = slot === null ? 0 : price === null ? slot : slot + 1;
  return {
    price,
    fromSlot,
    odds: price === null ? null : oddsAbove(prediction, price, fromSlot),
  };
}

export interface MemberOdds {
  member: ForecastMember;
  self: boolean;
  fromSlot: number;
  /** Null when no half-days are left for this island. */
  odds: Odds | null;
  chance: number;
  /** The chance this half-day's unreported price is already above the best. */
  alreadyAbove: number | null;
}

export interface GroupOdds {
  /** The best price anyone reported for this half-day. */
  price: number;
  holder: ForecastMember;
  /** The best price right now is yours. */
  yours: boolean;
  chance: number;
  certain: boolean;
  /** The best price reported by someone other than you, for comparison. */
  bestFriend: { member: ForecastMember; price: number } | null;
  /** Counted islands, most likely to beat the price first. */
  islands: MemberOdds[];
  /** Friends left out: no prices this week, or prices that match no pattern. */
  noPrices: string[];
  unmatched: string[];
}

function hasPrices(member: SharedPlayerWeek): boolean {
  return member.week.purchasePrice !== null || member.week.prices.some((price) => price !== null);
}

/**
 * The chance that anyone in the group beats the best price reported for this
 * half-day before Saturday closes. Only islands with a price this week count:
 * entering prices is the best sign a friend will check theirs and open their gates.
 */
export function groupOdds(
  members: ForecastMember[],
  owner: string,
  slot: number,
): GroupOdds | null {
  const reported = members
    .filter((member) => member.week.prices[slot] !== null)
    .sort((left, right) => (right.week.prices[slot] ?? 0) - (left.week.prices[slot] ?? 0));
  const holder = reported[0];
  if (!holder) return null;
  const price = holder.week.prices[slot] ?? 0;
  const counted = members.filter(
    (member) => hasPrices(member) && member.prediction.status === 'possible',
  );
  if (counted.length === 0) return null;
  const islands = counted
    .map((member): MemberOdds => {
      const own = member.week.prices[slot];
      const fromSlot = own === null ? slot : slot + 1;
      const odds = oddsAbove(member.prediction, price, fromSlot);
      return {
        member,
        self: member.player.id === owner,
        fromSlot,
        odds,
        chance: odds?.chance ?? 0,
        alreadyAbove: own === null ? slotChanceAbove(member.prediction, price, slot) : null,
      };
    })
    .sort(
      (left, right) =>
        right.chance - left.chance ||
        left.member.player.displayName.localeCompare(right.member.player.displayName),
    );
  const friend = reported.find((member) => member.player.id !== owner);
  const friends = members.filter((member) => member.player.id !== owner);
  return {
    price,
    holder,
    yours: holder.player.id === owner,
    chance: combineChances(islands.map((island) => island.chance)),
    certain: islands.some((island) => island.odds?.certain),
    bestFriend: friend ? { member: friend, price: friend.week.prices[slot] ?? 0 } : null,
    islands,
    noPrices: friends
      .filter((member) => !hasPrices(member))
      .map((member) => member.player.displayName),
    unmatched: friends
      .filter((member) => hasPrices(member) && member.prediction.status === 'inconsistent')
      .map((member) => member.player.displayName),
  };
}

export function partOfDay(slot: number): string {
  return slot % 2 ? 'afternoon' : 'morning';
}

/** Why an island could, or can’t, beat the price. */
export function islandReason(island: MemberOdds): string {
  const { odds } = island;
  if (!odds) return 'No half-days left this week';
  if (odds.impossible || !odds.driver)
    return `${island.self ? 'Your island tops' : 'Tops'} out at ${odds.bestCase}`;
  return odds.driver.probability >= 0.995
    ? `${odds.driver.label}, up to ${odds.bestCase}`
    : `${odds.driver.label} still possible (${percent(odds.driver.probability)})`;
}

function nameList(names: string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who was left out of the group number, or an empty string when nobody was. */
export function notCountedNote({ noPrices, unmatched }: GroupOdds): string {
  const parts = [
    noPrices.length
      ? `${nameList(noPrices)}, who ${noPrices.length === 1 ? 'has' : 'have'} no prices this week`
      : '',
    unmatched.length ? `${nameList(unmatched)}, whose prices don’t match a pattern` : '',
  ].filter(Boolean);
  return parts.length ? `Not counted: ${parts.join('; ')}.` : '';
}

/** "by Saturday night", or "by tonight" once it is Saturday. */
export function deadline(slot: number): string {
  return slot >= 10 ? 'by tonight' : 'by Saturday night';
}
