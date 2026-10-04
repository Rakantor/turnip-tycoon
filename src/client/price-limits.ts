import { PURCHASE_PRICE_RANGE, SELLING_PRICE_RANGE } from '../shared/week';

export type PriceKind = 'purchase' | 'selling';

export function priceRange(kind: PriceKind): { min: number; max: number } {
  return kind === 'purchase' ? PURCHASE_PRICE_RANGE : SELLING_PRICE_RANGE;
}

/**
 * Whether typing more digits could still turn a draft into an allowed price.
 * Price fields reject keystrokes that fail this, so out-of-range values such as
 * "111" for Sunday or "661" for a sale cannot be typed at all.
 */
export function canCompletePrice(draft: string, kind: PriceKind): boolean {
  if (draft === '') return true;
  if (!/^[1-9]\d*$/.test(draft)) return false;
  const { min, max } = priceRange(kind);
  const value = Number(draft);
  for (let extra = 0; draft.length + extra <= String(max).length; extra++) {
    const scale = 10 ** extra;
    if (value * scale <= max && (value + 1) * scale - 1 >= min) return true;
  }
  return false;
}

/** A finished entry: a price, null for a cleared field, or undefined when out of range. */
export function parsePrice(draft: string, kind: PriceKind): number | null | undefined {
  if (draft === '') return null;
  const { min, max } = priceRange(kind);
  const value = Number(draft);
  return /^\d+$/.test(draft) && value >= min && value <= max ? value : undefined;
}
