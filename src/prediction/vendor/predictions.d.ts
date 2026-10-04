/** Typed boundary for the pinned, vendored Turnip Prophet JavaScript. */
export interface UpstreamRange {
  min: number;
  max: number;
}

export interface UpstreamPossibility {
  /** 0–3 are actual patterns; 4 is the aggregate row. */
  pattern_number: number;
  prices: UpstreamRange[];
  probability?: number;
  category_total_probability?: number;
  weekGuaranteedMinimum: number;
  weekMax: number;
}

export class Predictor {
  constructor(prices: number[], firstBuy: boolean, previousPattern: number | null);
  fudge_factor: number;
  analyze_possibilities(): UpstreamPossibility[];
  intceil(value: number): number;
}
