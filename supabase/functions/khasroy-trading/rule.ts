// The live rule, kept small for the edge function: close beyond the highest high / lowest low of
// the previous 100 four-hour candles; stop 1.5 ATR(14, Wilder). tests/trading.mjs checks that it
// gives exactly the same signals as donchian(100, 1.5, …) in lib/trading/research.ts.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function atr(c: Candle[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(0);
  let prev = 0;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[i].h - c[i].l : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    prev = i === 0 ? tr : (prev * (n - 1) + tr) / n;
    out[i] = prev;
  }
  return out;
}

/** Breakout signal on bar i (or null), with the stop distance. */
export function breakout(c: Candle[], i: number, n = 100, stopAtr = 1.5): { side: "long" | "short"; risk: number } | null {
  if (i < n) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i - n; k < i; k++) {
    if (c[k].h > hi) hi = c[k].h;
    if (c[k].l < lo) lo = c[k].l;
  }
  const risk = stopAtr * atr(c)[i];
  if (c[i].c > hi) return { side: "long", risk };
  if (c[i].c < lo) return { side: "short", risk };
  return null;
}
