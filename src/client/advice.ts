import type { PredictionResult } from '../prediction';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  return `${DAYS[Math.floor(index / 2)]} ${index % 2 ? 'afternoon' : 'morning'}`;
}

export function slotShortName(index: number): string {
  return `${DAYS[Math.floor(index / 2)].slice(0, 3)} ${index % 2 ? 'PM' : 'AM'}`;
}

export function percent(probability: number): string {
  const rounded = Math.round(probability * 100);
  return rounded === 0 && probability > 0 ? '<1%' : `${rounded}%`;
}

/** Never rounds an uncertain chance up to 100%; certainty is said in words instead. */
export function oddsPercent(chance: number): string {
  return chance >= 0.995 && chance < 1 ? '>99%' : percent(chance);
}

function eyebrowFor(slot: number | null): string {
  return slot === null ? 'Sunday forecast' : `${slotName(slot)} forecast`;
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
      eyebrow: 'Your weekly forecast',
      lead: 'Enter what Daisy Mae charged on Sunday, or any price you’ve seen, and I’ll forecast your week.',
    };
  if (prediction.status === 'inconsistent')
    return {
      ...base,
      eyebrow: eyebrowFor(slot),
      lead: 'Hmm, these prices don’t match any pattern. Check your entries and week settings — your prices are kept.',
    };

  const top = prediction.patterns[0];
  const patternChip = {
    text: `${percent(top.probability)} ${top.label.toLowerCase()}`,
    tone: 'leaf' as const,
  };
  const oddsChips: Advice['chips'] =
    odds === null || odds.chance === 0
      ? []
      : [
          {
            text: odds.certain
              ? 'A higher price is coming'
              : `${oddsPercent(odds.chance)} chance of more than ${odds.price}`,
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
      lead: 'Every price this week is in. Turnips spoil on Sunday, so sell before Nook’s Cranny closes on Saturday night.',
      chips: [patternChip],
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
  const when =
    peakSlots.length === 1
      ? ` on ${slotName(peakSlot)}`
      : ` between ${slotName(peakSlots[0])} and ${slotName(peakSlots[peakSlots.length - 1])}`;

  if (current !== null && current >= peak) {
    const ratio = purchasePrice ? current / purchasePrice : null;
    return {
      eyebrow: eyebrowFor(slot),
      lead: 'Today’s ',
      highlight: `${current} bells`,
      trail: ' is as good as it gets this week. Time to sell!',
      chips: [
        patternChip,
        ...(ratio !== null && ratio >= 1
          ? [{ text: `${ratio.toFixed(1)}× what you paid`, tone: 'gold' as const }]
          : []),
      ],
      bestSlot: slot,
    };
  }

  const peakChips = (): Advice['chips'] => [
    patternChip,
    ...oddsChips,
    peakSlots.length > 1
      ? { text: 'Peak day still open', tone: 'gold' }
      : purchasePrice !== null && floor >= purchasePrice
        ? { text: `Even the low end, ${floor}, beats what you paid`, tone: 'gold' }
        : { text: `Could be as low as ${floor} then`, tone: 'gold' },
  ];
  const worthWatching =
    peakSlots.length === 1 && (purchasePrice === null || peak > purchasePrice) ? peakSlot : null;

  if (top.id === 'decreasing' && top.probability >= 0.75)
    return {
      eyebrow: eyebrowFor(slot),
      lead: 'Prices will most likely keep sliding this week. If you need bells, ',
      highlight: 'selling soon',
      trail: ' beats waiting.',
      chips: [patternChip, ...oddsChips, { text: `Small chance of up to ${peak}`, tone: 'gold' }],
      bestSlot: null,
    };

  if ((top.id === 'large-spike' || top.id === 'small-spike') && top.probability >= 0.5) {
    const certain = top.probability >= 0.8;
    const lead =
      top.id === 'large-spike'
        ? `Hold on to those turnips! A big spike ${certain ? 'is coming' : 'looks likely'} — they could sell for `
        : `Hang on! A small spike ${certain ? 'is coming' : 'looks likely'} — they could sell for `;
    return {
      eyebrow: eyebrowFor(slot),
      lead,
      highlight: `up to ${peak} bells`,
      trail: `${when}.`,
      chips: peakChips(),
      bestSlot: worthWatching,
    };
  }

  if (top.id === 'fluctuating' && top.probability >= 0.5)
    return {
      eyebrow: eyebrowFor(slot),
      lead: 'Prices will bounce around this week — ',
      highlight: `up to ${peak} bells`,
      trail: ` is possible${when}. Sell when you see a price you like.`,
      chips: peakChips(),
      bestSlot: worthWatching,
    };

  return {
    eyebrow: eyebrowFor(slot),
    lead: `It’s too early to call. ${top.label} is most likely, and prices could reach `,
    highlight: `up to ${peak} bells`,
    trail: `${when}.`,
    chips: peakChips(),
    bestSlot: worthWatching,
  };
}

function pastAdvice(prediction: PredictionResult, prices: (number | null)[]): Advice {
  const base = { eyebrow: 'Looking back', highlight: '', trail: '', chips: [], bestSlot: null };
  if (prediction.status === 'needs-input')
    return { ...base, lead: 'No prices were saved for this week.' };
  const entered = prices
    .map((price, index) => ({ price, index }))
    .filter((entry): entry is { price: number; index: number } => entry.price !== null);
  const best = entered.length
    ? entered.reduce((top, entry) => (entry.price > top.price ? entry : top))
    : null;
  const top = prediction.status === 'possible' ? prediction.patterns[0] : null;
  // A pattern shown as 100% is stated plainly, without "most likely".
  const lead = !top
    ? 'These prices didn’t match any pattern.'
    : percent(top.probability) === '100%'
      ? `This was a ${top.label.toLowerCase()} week.`
      : `This was most likely a ${top.label.toLowerCase()} week (${percent(top.probability)}).`;
  if (!best) return { ...base, lead };
  return {
    ...base,
    lead: `${lead} Your best price was `,
    highlight: `${best.price} bells`,
    trail: ` on ${slotName(best.index)}.`,
    bestSlot: best.index,
  };
}
