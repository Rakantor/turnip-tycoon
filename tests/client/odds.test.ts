import { describe, expect, it } from 'vitest';
import { predictWeek } from '../../src/prediction';
import type { SharedPlayerWeek } from '../../src/shared/groups';
import { emptyWeek } from '../../src/shared/week';
import {
  beatsBy,
  groupOdds,
  islandOdds,
  islandReason,
  notCountedNote,
  reportedPrice,
  type ForecastMember,
} from '../../src/client/odds';

const _ = null;
const WEEK = '2026-10-04';
// Thursday afternoon in the design's example week.
const THURSDAY_PM = 7;

function member(
  id: string,
  purchasePrice: number | null,
  ...entered: (number | null)[]
): ForecastMember {
  const week = {
    ...emptyWeek(id, WEEK),
    purchasePrice,
    prices: Array.from({ length: 12 }, (__, index) => entered[index] ?? null),
  };
  const shared: SharedPlayerWeek = {
    player: {
      id,
      displayName: id[0].toUpperCase() + id.slice(1),
      islandName: null,
      friendCode: '',
    },
    week,
    groupIds: ['group'],
  };
  return { ...shared, prediction: predictWeek(week) };
}

const you = member('you', 95, 100, 120, 130, 75, 68, 104, 122, 128);
const rosa = member('rosa', 104, 118, 80, 74, 66, 128, 99, 112, 141);
const jun = member('jun', 92, 82, 79, 75, 71, 68, 64, 61);
const mika = member('mika', 101, _, _, 84, 80);
const sam = member('sam', null);

describe('your island’s odds', () => {
  it('compares with this half-day’s price and looks past it', () => {
    const own = islandOdds(you.week, you.prediction, THURSDAY_PM);
    expect(own.price).toBe(128);
    expect(own.fromSlot).toBe(8);
    expect(own.odds?.chance).toBeCloseTo(0.104, 2);
  });

  it('compares with the latest price until this half-day’s is in, keeping it open', () => {
    const own = islandOdds(jun.week, jun.prediction, THURSDAY_PM);
    expect(own).toMatchObject({ price: 61, priceSlot: 6, fromSlot: THURSDAY_PM });
    expect(own.odds?.chance).toBeGreaterThan(0);
  });

  it('closes an unreported half-day after 10 PM', () => {
    const own = islandOdds(jun.week, jun.prediction, THURSDAY_PM, true);
    expect(own).toMatchObject({ price: 61, priceSlot: 6, fromSlot: 8 });
    const reported = islandOdds(you.week, you.prediction, THURSDAY_PM, true);
    expect(reported).toMatchObject({ price: 128, priceSlot: THURSDAY_PM, fromSlot: 8 });
  });

  it('compares with what you paid before any selling price', () => {
    const own = islandOdds(mika.week, mika.prediction, 1);
    expect(own).toMatchObject({ price: 101, priceSlot: null, fromSlot: 1 });
    expect(own.odds).not.toBeNull();
  });

  it('has nothing to compare with before any price', () => {
    expect(islandOdds(sam.week, sam.prediction, 0)).toMatchObject({ price: null, odds: null });
  });

  it('compares with what you paid on Sunday', () => {
    const sunday = member('you', 100);
    const own = islandOdds(sunday.week, sunday.prediction, null);
    expect(own.price).toBe(100);
    expect(own.fromSlot).toBe(0);
    expect(own.odds?.chance).toBeCloseTo(0.852, 2);
  });

  it('has nothing left to beat after Saturday afternoon', () => {
    const saturday = member('you', 100, 88, 84, 80, 76, 72, 68, 64, 60, 56, 52, 48, 44);
    expect(islandOdds(saturday.week, saturday.prediction, 11).odds).toBeNull();
  });
});

describe('group odds', () => {
  const odds = groupOdds([you, rosa, jun, mika, sam], 'you', THURSDAY_PM);

  it('beats the best price anyone has right now', () => {
    expect(odds?.price).toBe(141);
    expect(odds?.priceSlot).toBe(THURSDAY_PM);
    expect(odds?.holder.player.id).toBe('rosa');
    expect(odds?.yours).toBe(false);
    expect(odds?.bestFriend?.price).toBe(141);
    expect(odds?.chance).toBeCloseTo(0.682, 2);
  });

  it('counts only islands with prices this week, most likely first', () => {
    expect(odds?.islands.map((island) => island.member.player.id)).toEqual([
      'mika',
      'jun',
      'rosa',
      'you',
    ]);
    expect(odds?.noPrices).toEqual(['Sam']);
    expect(notCountedNote(odds!)).toBe('Not counted: Sam, who has no prices this week.');
  });

  it('keeps an unreported half-day open and says how likely it is already higher', () => {
    const [mikaOdds] = odds!.islands;
    expect(mikaOdds.fromSlot).toBe(THURSDAY_PM);
    expect(mikaOdds.alreadyAbove).toBeCloseTo(0.38, 2);
    expect(odds!.islands.find((island) => island.self)?.alreadyAbove).toBeNull();
  });

  it('explains each island in plain words', () => {
    const reasons = Object.fromEntries(
      odds!.islands.map((island) => [island.member.player.id, islandReason(island)]),
    );
    expect(reasons).toEqual({
      mika: 'Large spike still possible (47%)',
      jun: 'Large spike still possible (19%)',
      rosa: 'Fluctuating, up to 146',
      you: 'Your island tops out at 133',
    });
  });

  it('names friends whose prices match no pattern', () => {
    const odd = member('lee', 100, 999);
    const note = notCountedNote(groupOdds([you, odd, sam], 'you', THURSDAY_PM)!);
    expect(note).toBe(
      'Not counted: Sam, who has no prices this week; Lee, whose prices don’t match a pattern.',
    );
  });

  it('beats the latest best price until someone reports this half-day', () => {
    const earlier = groupOdds([jun, mika], 'you', THURSDAY_PM);
    expect(earlier).toMatchObject({ price: 61, priceSlot: 6 });
    expect(earlier?.holder.player.id).toBe('jun');
    expect(earlier?.islands.every((island) => island.fromSlot === THURSDAY_PM)).toBe(true);
    expect(groupOdds([sam, member('lee', 99)], 'you', THURSDAY_PM)).toBeNull();
  });

  it('closes unreported half-days after 10 PM', () => {
    const late = groupOdds([you, rosa, jun, mika, sam], 'you', THURSDAY_PM, true)!;
    expect(late.islands.every((island) => island.fromSlot === 8)).toBe(true);
    expect(late.islands.every((island) => island.alreadyAbove === null)).toBe(true);
    expect(groupOdds([you, rosa], 'you', 11, true)).toBeNull();
  });

  it('says when an earlier price was reported', () => {
    expect(reportedPrice(61, 6, THURSDAY_PM)).toBe('this morning’s 61');
    expect(reportedPrice(98, 5, THURSDAY_PM)).toBe('Wednesday afternoon’s 98');
  });

  it('notices when the best price is yours', () => {
    const group = groupOdds([you, jun, mika], 'you', THURSDAY_PM);
    expect(group?.yours).toBe(true);
    expect(group?.bestFriend).toBeNull();
  });

  it('says tonight once it is Saturday', () => {
    const group = groupOdds([you, jun, mika], 'you', THURSDAY_PM)!;
    expect(beatsBy({ ...group, certain: false }, THURSDAY_PM)).toMatch(/by Saturday night$/);
    expect(beatsBy({ ...group, certain: false }, 10)).toMatch(/by tonight$/);
    expect(beatsBy({ ...group, certain: true }, 10)).toMatch(/^someone beats/);
  });
});
