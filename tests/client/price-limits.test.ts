import { describe, expect, it } from 'vitest';
import { canCompletePrice, parsePrice } from '../../src/client/price-limits';

describe('price limits', () => {
  it('accepts Sunday purchase prices from 90 to 110 bells', () => {
    expect(parsePrice('90', 'purchase')).toBe(90);
    expect(parsePrice('110', 'purchase')).toBe(110);
    expect(parsePrice('89', 'purchase')).toBeUndefined();
    expect(parsePrice('111', 'purchase')).toBeUndefined();
    expect(parsePrice('', 'purchase')).toBeNull();
  });

  it('accepts selling prices from 9 to 660 bells', () => {
    expect(parsePrice('9', 'selling')).toBe(9);
    expect(parsePrice('660', 'selling')).toBe(660);
    expect(parsePrice('8', 'selling')).toBeUndefined();
    expect(parsePrice('661', 'selling')).toBeUndefined();
  });

  it('only lets Sunday drafts grow toward 90–110', () => {
    for (const draft of ['', '9', '1', '10', '11', '95', '110']) {
      expect(canCompletePrice(draft, 'purchase'), draft).toBe(true);
    }
    for (const draft of ['8', '2', '12', '111', '0', '09', '1000', '9a']) {
      expect(canCompletePrice(draft, 'purchase'), draft).toBe(false);
    }
  });

  it('only lets selling drafts grow toward 9–660', () => {
    for (const draft of ['', '1', '7', '9', '66', '67', '600', '660']) {
      expect(canCompletePrice(draft, 'selling'), draft).toBe(true);
    }
    for (const draft of ['0', '05', '661', '670', '700', '1000']) {
      expect(canCompletePrice(draft, 'selling'), draft).toBe(false);
    }
  });
});
