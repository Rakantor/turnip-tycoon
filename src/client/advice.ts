import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import type { PatternId, PredictionResult } from '../prediction';

const SLOT_NAMES = [
  msg`Monday morning`,
  msg`Monday afternoon`,
  msg`Tuesday morning`,
  msg`Tuesday afternoon`,
  msg`Wednesday morning`,
  msg`Wednesday afternoon`,
  msg`Thursday morning`,
  msg`Thursday afternoon`,
  msg`Friday morning`,
  msg`Friday afternoon`,
  msg`Saturday morning`,
  msg`Saturday afternoon`,
];

const SLOT_SHORT_NAMES = [
  msg({ message: 'Mon AM', comment: 'Short label for Monday morning, in tight table columns' }),
  msg({ message: 'Mon PM', comment: 'Short label for Monday afternoon, in tight table columns' }),
  msg({ message: 'Tue AM', comment: 'Short label for Tuesday morning, in tight table columns' }),
  msg({ message: 'Tue PM', comment: 'Short label for Tuesday afternoon, in tight table columns' }),
  msg({ message: 'Wed AM', comment: 'Short label for Wednesday morning, in tight table columns' }),
  msg({
    message: 'Wed PM',
    comment: 'Short label for Wednesday afternoon, in tight table columns',
  }),
  msg({ message: 'Thu AM', comment: 'Short label for Thursday morning, in tight table columns' }),
  msg({ message: 'Thu PM', comment: 'Short label for Thursday afternoon, in tight table columns' }),
  msg({ message: 'Fri AM', comment: 'Short label for Friday morning, in tight table columns' }),
  msg({ message: 'Fri PM', comment: 'Short label for Friday afternoon, in tight table columns' }),
  msg({ message: 'Sat AM', comment: 'Short label for Saturday morning, in tight table columns' }),
  msg({ message: 'Sat PM', comment: 'Short label for Saturday afternoon, in tight table columns' }),
];

const PATTERN_COMMENT =
  'A weekly turnip price pattern. The game never names them; use the term players use.';

/** In the order the week settings and pattern lists show them. */
export const PATTERNS: { id: PatternId; name: MessageDescriptor }[] = [
  { id: 'fluctuating', name: msg({ message: 'Fluctuating', comment: PATTERN_COMMENT }) },
  { id: 'large-spike', name: msg({ message: 'Large spike', comment: PATTERN_COMMENT }) },
  { id: 'decreasing', name: msg({ message: 'Decreasing', comment: PATTERN_COMMENT }) },
  { id: 'small-spike', name: msg({ message: 'Small spike', comment: PATTERN_COMMENT }) },
];

export type ChipTone = 'leaf' | 'gold' | 'sand' | 'clay';

export interface Advice {
  eyebrow: string;
  /** The message reads lead + highlight + trail; only the highlight is emphasized. */
  lead: string;
  highlight: string;
  trail: string;
  chips: { text: string; tone: ChipTone }[];
  /** The half-day worth watching, marked on the week board and chart. */
  bestSlot: number | null;
}

export function slotName(index: number): string {
  return i18n._(SLOT_NAMES[index]);
}

export function slotShortName(index: number): string {
  return i18n._(SLOT_SHORT_NAMES[index]);
}

// 4 January 2026 was a Sunday.
const weekdayDate = (day: number) => new Date(2026, 0, 4 + day, 12);

/** A weekday's name, from 0 for Sunday to 6 for Saturday. */
export function dayName(day: number): string {
  return i18n.date(weekdayDate(day), { weekday: 'long' });
}

/** A weekday's short name, from 0 for Sunday to 6 for Saturday. */
export function dayShortName(day: number): string {
  return i18n.date(weekdayDate(day), { weekday: 'short' });
}

export function patternName(id: PatternId): string {
  return i18n._(PATTERNS.find((pattern) => pattern.id === id)!.name);
}

function formatPercent(value: number): string {
  return i18n.number(value, { style: 'percent', maximumFractionDigits: 0 });
}

export function percent(probability: number): string {
  const rounded = Math.round(probability * 100);
  return rounded === 0 && probability > 0
    ? `<${formatPercent(0.01)}`
    : formatPercent(rounded / 100);
}

/** A pattern's chance to one decimal, so small chances still show. */
export function patternPercent(probability: number): string {
  const format = (value: number) =>
    i18n.number(value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return probability < 0.001 ? `<${format(0.001)}` : format(probability);
}

/** Never rounds an uncertain chance up to 100%; certainty is said in words instead. */
export function oddsPercent(chance: number): string {
  return chance >= 0.995 && chance < 1 ? `>${formatPercent(0.99)}` : percent(chance);
}

/** Splits a translated message around its one emphasized part, marked <0>…</0>. */
function emphasized(message: string): Pick<Advice, 'lead' | 'highlight' | 'trail'> {
  const match = /^([^]*?)<0>([^]*?)<\/0>([^]*)$/.exec(message);
  return match
    ? { lead: match[1], highlight: match[2], trail: match[3] }
    : { lead: message, highlight: '', trail: '' };
}

function eyebrowFor(slot: number | null): string {
  if (slot === null) return t`Sunday forecast`;
  const halfDay = slotName(slot);
  return t({ message: `${halfDay} forecast`, comment: 'halfDay is, e.g., "Monday morning"' });
}

function patternChip(id: PatternId, chance: string): string {
  switch (id) {
    case 'fluctuating':
      return t({ message: `${chance} fluctuating`, comment: 'The chance of a pattern, as a chip' });
    case 'large-spike':
      return t({ message: `${chance} large spike`, comment: 'The chance of a pattern, as a chip' });
    case 'decreasing':
      return t({ message: `${chance} decreasing`, comment: 'The chance of a pattern, as a chip' });
    case 'small-spike':
      return t({ message: `${chance} small spike`, comment: 'The chance of a pattern, as a chip' });
  }
}

/**
 * Plain-language guidance for a week. It only restates what the forecast
 * supports: the most likely pattern and the highest price still possible.
 */
export function weekAdvice({
  prediction,
  prices,
  purchasePrice,
  slot,
  isCurrent,
  odds = null,
}: {
  prediction: PredictionResult;
  prices: (number | null)[];
  purchasePrice: number | null;
  /** The current half-day, or null on Sunday and for past weeks. */
  slot: number | null;
  isCurrent: boolean;
  /** The chance of beating the price you can get now, once it is entered. */
  odds?: { price: number; chance: number; certain: boolean } | null;
}): Advice {
  const base = { highlight: '', trail: '', chips: [], bestSlot: null };
  if (!isCurrent) return pastAdvice(prediction, prices);
  if (prediction.status === 'needs-input')
    return {
      ...base,
      eyebrow: t`Your weekly forecast`,
      lead: t`Enter what Daisy Mae charged on Sunday, or any price you’ve seen, and I’ll forecast your week.`,
    };
  if (prediction.status === 'inconsistent')
    return {
      ...base,
      eyebrow: eyebrowFor(slot),
      lead: t`Hmm, these prices don’t match any pattern. Check your entries and week settings — your prices are kept.`,
    };

  const top = prediction.patterns[0];
  const topChip = { text: patternChip(top.id, percent(top.probability)), tone: 'leaf' as const };
  const oddsChance = odds === null ? '' : oddsPercent(odds.chance);
  const oddsChips: Advice['chips'] =
    odds === null || odds.chance === 0
      ? []
      : [
          {
            text: odds.certain
              ? t`A higher price is coming`
              : t`${oddsChance} chance of more than ${odds.price}`,
            tone: 'gold',
          },
        ];
  const upcoming = prices
    .map((price, index) => ({ price, index }))
    .filter(({ price, index }) => price === null && (slot === null || index >= slot))
    .map(({ index }) => index);
  if (upcoming.length === 0)
    return {
      ...base,
      eyebrow: eyebrowFor(slot),
      lead: t`Every price this week is in. Turnips spoil on Sunday, so sell before Nook’s Cranny closes on Saturday night.`,
      chips: [topChip],
    };

  const peakSlot = upcoming.reduce((best, index) =>
    prediction.slots[index].max > prediction.slots[best].max ? index : best,
  );
  const peak = prediction.slots[peakSlot].max;
  const floor = prediction.slots[peakSlot].min;
  const current = slot === null ? null : prices[slot];
  // Early in the week several half-days can reach the same maximum; naming
  // only the first of them would suggest a precision the forecast lacks.
  const peakSlots = upcoming.filter((index) => prediction.slots[index].max >= peak * 0.97);
  const halfDay = slotName(peakSlot);
  const first = slotName(peakSlots[0]);
  const last = slotName(peakSlots[peakSlots.length - 1]);
  const when =
    peakSlots.length === 1
      ? t({ message: `on ${halfDay}`, comment: 'When the peak could come; ends a sentence' })
      : t({
          message: `between ${first} and ${last}`,
          comment: 'When the peak could come; ends a sentence',
        });

  if (current !== null && current >= peak) {
    const ratio = purchasePrice ? current / purchasePrice : null;
    const times =
      ratio === null
        ? ''
        : i18n.number(ratio, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return {
      eyebrow: eyebrowFor(slot),
      ...emphasized(
        t`Today’s <0>${current} bells</0> is as good as it gets this week. Time to sell!`,
      ),
      chips: [
        topChip,
        ...(ratio !== null && ratio >= 1
          ? [{ text: t`${times}× what you paid`, tone: 'gold' as const }]
          : []),
      ],
      bestSlot: slot,
    };
  }

  const peakChips = (): Advice['chips'] => [
    topChip,
    ...oddsChips,
    peakSlots.length > 1
      ? { text: t`Peak day still open`, tone: 'gold' }
      : purchasePrice !== null && floor >= purchasePrice
        ? { text: t`Even the low end, ${floor}, beats what you paid`, tone: 'gold' }
        : { text: t`Could be as low as ${floor} then`, tone: 'gold' },
  ];
  const worthWatching =
    peakSlots.length === 1 && (purchasePrice === null || peak > purchasePrice) ? peakSlot : null;

  if (top.id === 'decreasing' && top.probability >= 0.75)
    return {
      eyebrow: eyebrowFor(slot),
      ...emphasized(
        t`Prices will most likely keep sliding this week. If you need bells, <0>selling soon</0> beats waiting.`,
      ),
      chips: [topChip, ...oddsChips, { text: t`Small chance of up to ${peak}`, tone: 'gold' }],
      bestSlot: null,
    };

  if ((top.id === 'large-spike' || top.id === 'small-spike') && top.probability >= 0.5) {
    const certain = top.probability >= 0.8;
    const message =
      top.id === 'large-spike'
        ? certain
          ? t`Hold on to those turnips! A big spike is coming — they could sell for <0>up to ${peak} bells</0> ${when}.`
          : t`Hold on to those turnips! A big spike looks likely — they could sell for <0>up to ${peak} bells</0> ${when}.`
        : certain
          ? t`Hang on! A small spike is coming — they could sell for <0>up to ${peak} bells</0> ${when}.`
          : t`Hang on! A small spike looks likely — they could sell for <0>up to ${peak} bells</0> ${when}.`;
    return {
      eyebrow: eyebrowFor(slot),
      ...emphasized(message),
      chips: peakChips(),
      bestSlot: worthWatching,
    };
  }

  if (top.id === 'fluctuating' && top.probability >= 0.5)
    return {
      eyebrow: eyebrowFor(slot),
      ...emphasized(
        t`Prices will bounce around this week — <0>up to ${peak} bells</0> is possible ${when}. Sell when you see a price you like.`,
      ),
      chips: peakChips(),
      bestSlot: worthWatching,
    };

  const pattern = patternName(top.id);
  return {
    eyebrow: eyebrowFor(slot),
    ...emphasized(
      t`It’s too early to call. ${pattern} is most likely, and prices could reach <0>up to ${peak} bells</0> ${when}.`,
    ),
    chips: peakChips(),
    bestSlot: worthWatching,
  };
}

/** What a past week turned out to be, stated plainly when its pattern is certain. */
function pastVerdict(id: PatternId, certain: boolean, chance: string): string {
  switch (id) {
    case 'fluctuating':
      return certain
        ? t`This was a fluctuating week.`
        : t`This was most likely a fluctuating week (${chance}).`;
    case 'large-spike':
      return certain
        ? t`This was a large-spike week.`
        : t`This was most likely a large-spike week (${chance}).`;
    case 'decreasing':
      return certain
        ? t`This was a decreasing week.`
        : t`This was most likely a decreasing week (${chance}).`;
    case 'small-spike':
      return certain
        ? t`This was a small-spike week.`
        : t`This was most likely a small-spike week (${chance}).`;
  }
}

function pastAdvice(prediction: PredictionResult, prices: (number | null)[]): Advice {
  const base = { eyebrow: t`Looking back`, highlight: '', trail: '', chips: [], bestSlot: null };
  if (prediction.status === 'needs-input')
    return { ...base, lead: t`No prices were saved for this week.` };
  const entered = prices
    .map((price, index) => ({ price, index }))
    .filter((entry): entry is { price: number; index: number } => entry.price !== null);
  const best = entered.length
    ? entered.reduce((top, entry) => (entry.price > top.price ? entry : top))
    : null;
  const top = prediction.status === 'possible' ? prediction.patterns[0] : null;
  // A pattern shown as 100% is stated plainly, without "most likely".
  const verdict = !top
    ? t`These prices didn’t match any pattern.`
    : pastVerdict(top.id, Math.round(top.probability * 100) === 100, percent(top.probability));
  if (!best) return { ...base, lead: verdict };
  const bestPrice = best.price;
  const halfDay = slotName(best.index);
  return {
    ...base,
    ...emphasized(
      t({
        message: `${verdict} Your best price was <0>${bestPrice} bells</0> on ${halfDay}.`,
        comment:
          'verdict is a sentence about the week’s pattern, e.g. "This was a decreasing week."',
      }),
    ),
    bestSlot: best.index,
  };
}
