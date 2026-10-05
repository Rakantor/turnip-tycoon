/**
 * An independent oracle for the odds: the game's own price rules, from Ninji's
 * reverse-engineered code (https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b),
 * written separately from the engine under test. Entered prices are held fixed
 * and each simulated week is weighted by how likely those prices were, so even
 * heavily observed weeks need few samples. Seeded, so results are repeatable.
 */
const PRIOR = [4530 / 13082, 3236 / 13082, 1931 / 13082, 3385 / 13082];

function seeded(seed: number): () => number {
  // mulberry32
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const intceil = (value: number) => Math.trunc(value + 0.99999);

function sampler(random: () => number) {
  const between = (low: number, high: number) => low + random() * (high - low);
  const integer = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

  return function sample(knownBase: number | null, observed: (number | null)[]) {
    const base = knownBase ?? integer(90, 110);
    const lowest = (price: number) => (price - 0.99999) / base;
    const highest = (price: number) => (price + 0.00001) / base;
    let weight = 1;
    const prices: number[] = [];

    // intceil(randfloat(low, high) * base)
    const independent = (low: number, high: number) => {
      const seen = observed[prices.length];
      if (seen === null) return prices.push(intceil(between(low, high) * base));
      const from = Math.max(low, lowest(seen));
      const to = Math.min(high, highest(seen));
      weight *= to > from ? (to - from) / (high - low) : 0;
      prices.push(seen);
    };
    // rate = randfloat(low, high); then rate -= fall + randfloat(0, spread) each half-day
    const decreasing = (
      length: number,
      low: number,
      high: number,
      fall: number,
      spread: number,
    ) => {
      let rate = 0;
      for (let step = 0; step < length; step++) {
        const from = step === 0 ? low : rate - fall - spread;
        const to = step === 0 ? high : rate - fall;
        const seen = observed[prices.length];
        if (seen === null) rate = between(from, to);
        else {
          const lower = Math.max(from, lowest(seen));
          const upper = Math.min(to, highest(seen));
          if (upper <= lower) {
            weight = 0;
            rate = from;
          } else {
            weight *= (upper - lower) / (to - from);
            rate = between(lower, upper);
          }
        }
        prices.push(intceil(rate * base));
      }
    };

    const draw = random();
    const pattern =
      draw < PRIOR[0] ? 0 : draw < PRIOR[0] + PRIOR[1] ? 1 : draw < 1 - PRIOR[3] ? 2 : 3;
    if (pattern === 0) {
      const decreasing1 = random() < 0.5 ? 3 : 2;
      const high1 = integer(0, 6);
      const high23 = 7 - high1;
      const high3 = integer(0, high23 - 1);
      for (let index = 0; index < high1; index++) independent(0.9, 1.4);
      decreasing(decreasing1, 0.6, 0.8, 0.04, 0.06);
      for (let index = 0; index < high23 - high3; index++) independent(0.9, 1.4);
      decreasing(5 - decreasing1, 0.6, 0.8, 0.04, 0.06);
      for (let index = 0; index < high3; index++) independent(0.9, 1.4);
    } else if (pattern === 1) {
      const peakStart = integer(3, 9);
      decreasing(peakStart - 2, 0.85, 0.9, 0.03, 0.02);
      for (const [low, high] of [
        [0.9, 1.4],
        [1.4, 2],
        [2, 6],
        [1.4, 2],
        [0.9, 1.4],
      ])
        independent(low, high);
      while (prices.length < 12) independent(0.4, 0.9);
    } else if (pattern === 2) {
      decreasing(12, 0.85, 0.9, 0.03, 0.02);
    } else {
      const peakStart = integer(2, 9);
      decreasing(peakStart - 2, 0.4, 0.9, 0.03, 0.02);
      independent(0.9, 1.4);
      independent(0.9, 1.4);
      // The peak rate is drawn first; each shoulder is a rate up to it, minus one bell.
      const centre = observed[prices.length + 1];
      let peak: number;
      if (centre === null) peak = between(1.4, 2);
      else {
        const lower = Math.max(1.4, lowest(centre));
        const upper = Math.min(2, highest(centre));
        if (upper <= lower) {
          weight = 0;
          peak = 1.4;
        } else {
          weight *= (upper - lower) / 0.6;
          peak = between(lower, upper);
        }
      }
      const shoulder = () => {
        const seen = observed[prices.length];
        if (seen === null) return prices.push(intceil(between(1.4, peak) * base) - 1);
        const lower = Math.max(1.4, lowest(seen + 1));
        const upper = Math.min(peak, highest(seen + 1));
        weight *= upper > lower ? (upper - lower) / (peak - 1.4) : 0;
        prices.push(seen);
      };
      shoulder();
      prices.push(intceil(peak * base));
      shoulder();
      if (prices.length < 12) decreasing(12 - prices.length, 0.4, 0.9, 0.03, 0.02);
    }
    return { weight, prices };
  };
}

/** The simulated chance of a price above `price` from `fromSlot` through Saturday PM. */
export function simulatedChanceAbove(
  base: number | null,
  observed: (number | null)[],
  fromSlot: number,
  price: number,
  { samples = 300_000, seed = 1 } = {},
): number {
  const sample = sampler(seeded(seed));
  let total = 0;
  let above = 0;
  for (let index = 0; index < samples; index++) {
    const { weight, prices } = sample(base, observed);
    if (weight === 0) continue;
    total += weight;
    if (Math.max(...prices.slice(fromSlot)) > price) above += weight;
  }
  return above / total;
}
