// Khasroy Trading — strategy research. Several well-known families of rules, one honest
// simulator for all of them (market entry on the next bar, fees, slippage, funding, conservative
// fills), so they can be compared on the same data. Pure functions, causal: a signal at bar i
// uses bars 0..i and is executed at the open of bar i+1.

import type { Candle, Side } from "./smc.ts";
import { aggregate, atr } from "./smc.ts";

export type Signal = {
  at: number;
  side: Side;
  /** Initial stop distance in price units (defines 1 R). */
  risk: number;
};

export type Exit =
  | { kind: "target"; rr: number; maxBars?: number }
  /** Chandelier trail: stop follows the best close by `atrMult` ATRs once in profit. */
  | { kind: "trail"; atrMult: number; maxBars?: number }
  /** Close when a rule says so (opposite signal, mean reached); stop still protects. */
  | { kind: "rule"; maxBars?: number };

export type Costs = { taker: number; maker: number; slippage: number; fundingPer8h: number };
export const FUTURES_COSTS: Costs = { taker: 0.0005, maker: 0.0002, slippage: 0.0002, fundingPer8h: 0.0001 };

export type RTrade = { side: Side; entryAt: number; exitAt: number; entry: number; exit: number; r: number; time: number };

// ---------------------------------------------------------------------------------------------
// indicators

export function ema(x: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = new Array<number>(x.length);
  let prev = x[0];
  for (let i = 0; i < x.length; i++) out[i] = prev = i === 0 ? x[0] : x[i] * k + prev * (1 - k);
  return out;
}

export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= n) sum -= x[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function rsi(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(50);
  let up = 0;
  let down = 0;
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    const u = Math.max(0, d);
    const v = Math.max(0, -d);
    if (i <= n) {
      up += u / n;
      down += v / n;
    } else {
      up = (up * (n - 1) + u) / n;
      down = (down * (n - 1) + v) / n;
    }
    out[i] = down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  return out;
}

/** Highest high / lowest low of the `n` bars before i (not including i). */
export function channel(c: Candle[], n: number): { hi: number[]; lo: number[] } {
  const hi = new Array<number>(c.length).fill(NaN);
  const lo = new Array<number>(c.length).fill(NaN);
  for (let i = n; i < c.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let k = i - n; k < i; k++) {
      if (c[k].h > h) h = c[k].h;
      if (c[k].l < l) l = c[k].l;
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi, lo };
}

// ---------------------------------------------------------------------------------------------
// simulator

/**
 * One position per symbol. Entry at the next open with taker fee and slippage. The stop is
 * checked against the bar's extreme; a gap through the stop fills at the open. A bar that
 * touches both stop and target is a loss. Funding is charged for the time in the position.
 */
export function run(
  c: Candle[],
  signals: Signal[],
  exit: Exit,
  barHours: number,
  costs: Costs = FUTURES_COSTS,
  closeRule?: (i: number, side: Side) => boolean,
): RTrade[] {
  const a = atr(c);
  const out: RTrade[] = [];
  let free = 0;
  for (const s of signals) {
    if (s.at < free || s.at + 1 >= c.length) continue;
    const long = s.side === "long";
    const i0 = s.at + 1;
    const entry = c[i0].o * (1 + (long ? 1 : -1) * costs.slippage);
    const R = s.risk;
    if (!(R > 0)) continue;
    let stop = long ? entry - R : entry + R;
    const tp = exit.kind === "target" ? (long ? entry + exit.rr * R : entry - exit.rr * R) : NaN;
    let best = entry;
    let exitPrice = NaN;
    let exitAt = -1;
    let exitFee = costs.taker + costs.slippage;
    for (let i = i0; i < c.length; i++) {
      const b = c[i];
      // Stop first (conservative), gaps fill at the open.
      const stopHit = long ? b.l <= stop : b.h >= stop;
      if (stopHit) {
        exitPrice = long ? Math.min(stop, b.o) : Math.max(stop, b.o);
        exitAt = i;
        break;
      }
      if (exit.kind === "target" && (long ? b.h >= tp : b.l <= tp)) {
        exitPrice = tp;
        exitAt = i;
        exitFee = costs.maker;
        break;
      }
      if (exit.maxBars && i - i0 >= exit.maxBars) {
        exitPrice = b.c;
        exitAt = i;
        break;
      }
      if (exit.kind === "rule" && closeRule && closeRule(i, s.side)) {
        exitPrice = b.c;
        exitAt = i;
        break;
      }
      if (exit.kind === "trail") {
        best = long ? Math.max(best, b.c) : Math.min(best, b.c);
        const trail = long ? best - exit.atrMult * a[i] : best + exit.atrMult * a[i];
        stop = long ? Math.max(stop, trail) : Math.min(stop, trail);
      }
    }
    if (exitAt < 0) break; // still open at the end of the data
    const gross = long ? exitPrice - entry : entry - exitPrice;
    const hours = (exitAt - i0 + 1) * barHours;
    const fees = entry * costs.taker + exitPrice * exitFee + entry * costs.fundingPer8h * (hours / 8);
    out.push({ side: s.side, entryAt: i0, exitAt, entry, exit: exitPrice, r: (gross - fees) / R, time: c[i0].t });
    free = exitAt + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// strategies: each returns signals (and maybe a close rule) for a candle series

export type Strategy = {
  name: string;
  exit: Exit;
  build: (c: Candle[]) => { signals: Signal[]; closeRule?: (i: number, side: Side) => boolean };
};

/** Breakout of the N-bar channel in the direction of the long trend (turtle-like). */
export function donchian(n: number, stopAtr: number, exit: Exit, trendLen = 0): Strategy {
  return {
    name: `donchian ${n} stop${stopAtr}atr ${exitName(exit)}${trendLen ? ` ma${trendLen}` : ""}`,
    exit,
    build(c) {
      const a = atr(c);
      const { hi, lo } = channel(c, n);
      const ma = trendLen ? sma(c.map((x) => x.c), trendLen) : null;
      const signals: Signal[] = [];
      for (let i = Math.max(n, trendLen); i < c.length; i++) {
        const up = !ma || c[i].c > ma[i];
        if (c[i].c > hi[i] && up) signals.push({ at: i, side: "long", risk: stopAtr * a[i] });
        else if (c[i].c < lo[i] && (!ma || c[i].c < ma[i])) signals.push({ at: i, side: "short", risk: stopAtr * a[i] });
      }
      return { signals };
    },
  };
}

/** EMA cross with the slow EMA as trend; close on the opposite cross. */
export function emaCross(fast: number, slow: number, stopAtr: number, exit: Exit): Strategy {
  return {
    name: `ema ${fast}/${slow} stop${stopAtr}atr ${exitName(exit)}`,
    exit,
    build(c) {
      const a = atr(c);
      const cl = c.map((x) => x.c);
      const f = ema(cl, fast);
      const s = ema(cl, slow);
      const signals: Signal[] = [];
      for (let i = slow; i < c.length; i++) {
        if (f[i] > s[i] && f[i - 1] <= s[i - 1]) signals.push({ at: i, side: "long", risk: stopAtr * a[i] });
        if (f[i] < s[i] && f[i - 1] >= s[i - 1]) signals.push({ at: i, side: "short", risk: stopAtr * a[i] });
      }
      return { signals, closeRule: (i, side) => (side === "long" ? f[i] < s[i] : f[i] > s[i]) };
    },
  };
}

/** Short-term mean reversion: RSI(2) extreme against the trend of the 200 MA; exit above MA5. */
export function rsiRevert(low: number, stopAtr: number, exit: Exit): Strategy {
  return {
    name: `rsi2<${low} stop${stopAtr}atr ${exitName(exit)}`,
    exit,
    build(c) {
      const a = atr(c);
      const cl = c.map((x) => x.c);
      const r = rsi(cl, 2);
      const ma200 = sma(cl, 200);
      const ma5 = sma(cl, 5);
      const signals: Signal[] = [];
      for (let i = 200; i < c.length; i++) {
        if (cl[i] > ma200[i] && r[i] < low) signals.push({ at: i, side: "long", risk: stopAtr * a[i] });
        if (cl[i] < ma200[i] && r[i] > 100 - low) signals.push({ at: i, side: "short", risk: stopAtr * a[i] });
      }
      return { signals, closeRule: (i, side) => (side === "long" ? cl[i] > ma5[i] : cl[i] < ma5[i]) };
    },
  };
}

/** Volatility squeeze: Bollinger width at an N-bar low, then a close outside the band. */
export function squeeze(n: number, stopAtr: number, exit: Exit): Strategy {
  return {
    name: `squeeze ${n} stop${stopAtr}atr ${exitName(exit)}`,
    exit,
    build(c) {
      const a = atr(c);
      const cl = c.map((x) => x.c);
      const m = sma(cl, 20);
      const sd = cl.map((_, i) => {
        if (i < 19) return NaN;
        let s = 0;
        for (let k = i - 19; k <= i; k++) s += (cl[k] - m[i]) ** 2;
        return Math.sqrt(s / 20);
      });
      const width = cl.map((_, i) => (4 * sd[i]) / m[i]);
      const signals: Signal[] = [];
      for (let i = n + 20; i < c.length; i++) {
        let minW = Infinity;
        for (let k = i - n; k < i; k++) minW = Math.min(minW, width[k]);
        const squeezed = width[i - 1] <= minW * 1.1;
        if (!squeezed) continue;
        if (cl[i] > m[i] + 2 * sd[i]) signals.push({ at: i, side: "long", risk: stopAtr * a[i] });
        else if (cl[i] < m[i] - 2 * sd[i]) signals.push({ at: i, side: "short", risk: stopAtr * a[i] });
      }
      return { signals };
    },
  };
}

function exitName(e: Exit): string {
  if (e.kind === "target") return `tp1:${e.rr}`;
  if (e.kind === "trail") return `trail${e.atrMult}atr`;
  return "rule";
}

// ---------------------------------------------------------------------------------------------
// cross-sectional momentum: a portfolio, not single trades

/**
 * Every `rebalanceBars` bars: long the `top` pairs with the best `lookback` return, short the
 * `top` worst; equal weights, 1x total exposure. Returns the equity curve and its stats.
 */
export function momentumPortfolio(
  series: Record<string, Candle[]>,
  lookback: number,
  rebalanceBars: number,
  top: number,
  costs: Costs = FUTURES_COSTS,
  longOnlyWhenBtcUp = false,
): { equity: { t: number; v: number }[]; turnover: number } {
  const names = Object.keys(series);
  // Align on time.
  const times = [...new Set(names.flatMap((n) => series[n].map((c) => c.t)))].sort((a, b) => a - b);
  const close: Record<string, Map<number, number>> = Object.fromEntries(names.map((n) => [n, new Map(series[n].map((c) => [c.t, c.c]))]));
  let v = 1;
  const equity: { t: number; v: number }[] = [];
  let weights: Record<string, number> = {};
  let turnover = 0;
  const btc = names.find((n) => n.startsWith("BTC"));
  for (let k = lookback; k < times.length - 1; k++) {
    const t = times[k];
    if ((k - lookback) % rebalanceBars === 0) {
      const rets = names
        .map((n) => {
          const now = close[n].get(t);
          const then = close[n].get(times[k - lookback]);
          return now && then ? { n, r: now / then - 1 } : null;
        })
        .filter((x): x is { n: string; r: number } => Boolean(x))
        .sort((a, b) => b.r - a.r);
      const next: Record<string, number> = {};
      if (rets.length >= top * 2) {
        const btcUp = btc ? (rets.find((x) => x.n === btc)?.r ?? 0) > 0 : true;
        const longs = rets.slice(0, top);
        const shorts = rets.slice(-top);
        const sideWeight = longOnlyWhenBtcUp ? 1 / top : 0.5 / top;
        if (!longOnlyWhenBtcUp || btcUp) for (const x of longs) next[x.n] = sideWeight;
        if (!longOnlyWhenBtcUp || !btcUp) for (const x of shorts) next[x.n] = -sideWeight;
      }
      const changed = new Set([...Object.keys(weights), ...Object.keys(next)]);
      let traded = 0;
      for (const n of changed) traded += Math.abs((next[n] ?? 0) - (weights[n] ?? 0));
      turnover += traded;
      v *= 1 - traded * (costs.taker + costs.slippage);
      weights = next;
    }
    // Return to the next bar.
    let r = 0;
    for (const [n, w] of Object.entries(weights)) {
      const a = close[n].get(t);
      const b = close[n].get(times[k + 1]);
      if (a && b) r += w * (b / a - 1);
      r -= Math.abs(w) * costs.fundingPer8h * ((times[k + 1] - t) / 28_800_000);
    }
    v *= 1 + r;
    equity.push({ t: times[k + 1], v });
  }
  return { equity, turnover };
}

export { aggregate };
