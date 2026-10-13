// Khasroy Trading — Smart Money setups on 5-minute futures candles, found by fixed rules.
// Pure functions without dependencies: the same file runs the backtest (Node), the live scanner
// (server) and the tests. Everything is causal: a decision at bar i uses only bars 0..i.
//
// The model (long; short is the mirror):
//   1. Bias from the higher timeframe (1H built from 5m): the last break of a confirmed swing.
//   2. Liquidity sweep on 5m: a wick takes out a recent swing low and the bar closes back above it.
//   3. Change of character: soon after, a strong bar (body ≥ k·ATR) closes above the last swing high.
//   4. Entry in the fair value gap left by that move; stop under the sweep; target at R:R 1:3 or 1:5.
//   5. The limit order lives a limited time and is cancelled if price runs away or breaks the stop.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Side = "long" | "short";

export type Params = {
  /** Bars on each side that make a swing high/low (fractal). */
  swingK: number;
  /** 5m bars per higher-timeframe bar (12 = 1H). */
  htfFactor: number;
  swingKHtf: number;
  /** How far back (bars) a swing may be to count for a sweep. */
  sweepLookback: number;
  /** Bars after the sweep in which the change of character must happen. */
  chochWithin: number;
  /** Body of the change-of-character bar in ATRs. */
  displacementAtr: number;
  /** Where in the gap to enter: 0 = nearest edge, 1 = far edge. */
  entryDepth: number;
  slBufferAtr: number;
  /** Bars a pending order lives. */
  expiry: number;
  minStopPct: number;
  maxStopPct: number;
  /** UTC hours when new setups are allowed (empty = always). */
  hours: number[];
  /** Require the higher-timeframe bias to agree. */
  useBias: boolean;
  /** Minutes per input candle (5 for 5m; 15 when the backtest groups candles into 15m). */
  barMinutes: number;
};

export const DEFAULT_PARAMS: Params = {
  swingK: 3,
  htfFactor: 12,
  swingKHtf: 2,
  sweepLookback: 48,
  chochWithin: 12,
  displacementAtr: 1.0,
  entryDepth: 0.5,
  slBufferAtr: 0.15,
  expiry: 24,
  minStopPct: 0.25,
  maxStopPct: 2.0,
  hours: [],
  useBias: true,
  barMinutes: 5,
};

export type Setup = {
  side: Side;
  /** Index of the bar on which the setup is confirmed (order placed for the next bar). */
  at: number;
  time: number;
  entry: number;
  sl: number;
  /** Price of the swept liquidity, the change-of-character level and the gap, for the chart. */
  sweep: { at: number; level: number; extreme: number };
  choch: { at: number; level: number };
  gap: { at: number; low: number; high: number };
  bias: Side | null;
};

// ---------------------------------------------------------------------------------------------
// building blocks

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

/** Candles grouped by `factor` (e.g. 12 × 5m = 1H), aligned to time buckets. */
export function aggregate(c: Candle[], factor: number, barMs = 300_000): Candle[] {
  const size = factor * barMs;
  const out: Candle[] = [];
  for (const x of c) {
    const t = Math.floor(x.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, x.h);
      last.l = Math.min(last.l, x.l);
      last.c = x.c;
      last.v += x.v;
    } else out.push({ t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v });
  }
  return out;
}

/**
 * Swing points (fractals). A swing at bar j is only known at bar j + k, so each swing carries
 * the index where it becomes visible.
 */
export function swings(c: Candle[], k: number): { highs: { at: number; seen: number; level: number }[]; lows: { at: number; seen: number; level: number }[] } {
  const highs: { at: number; seen: number; level: number }[] = [];
  const lows: { at: number; seen: number; level: number }[] = [];
  for (let j = k; j < c.length - k; j++) {
    let hi = true;
    let lo = true;
    for (let d = 1; d <= k; d++) {
      if (!(c[j].h > c[j - d].h && c[j].h >= c[j + d].h)) hi = false;
      if (!(c[j].l < c[j - d].l && c[j].l <= c[j + d].l)) lo = false;
      if (!hi && !lo) break;
    }
    if (hi) highs.push({ at: j, seen: j + k, level: c[j].h });
    if (lo) lows.push({ at: j, seen: j + k, level: c[j].l });
  }
  return { highs, lows };
}

/** Bias of the higher timeframe after each of its bars: direction of the last broken swing. */
export function htfBias(h: Candle[], k: number): (Side | null)[] {
  const { highs, lows } = swings(h, k);
  const out: (Side | null)[] = new Array(h.length).fill(null);
  let bias: Side | null = null;
  let hi = 0;
  let lo = 0;
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (let i = 0; i < h.length; i++) {
    while (hi < highs.length && highs[hi].seen <= i) lastHigh = highs[hi++].level;
    while (lo < lows.length && lows[lo].seen <= i) lastLow = lows[lo++].level;
    if (lastHigh !== null && h[i].c > lastHigh) {
      bias = "long";
      lastHigh = null;
    } else if (lastLow !== null && h[i].c < lastLow) {
      bias = "short";
      lastLow = null;
    }
    out[i] = bias;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// setups

/**
 * Every setup the rules produce over the candles, in time order. `from` limits the scan to the
 * last bars (the live scanner looks only at what just closed).
 */
export function findSetups(c: Candle[], p: Params = DEFAULT_PARAMS, from = 0): Setup[] {
  if (c.length < 100) return [];
  const a = atr(c);
  const { highs, lows } = swings(c, p.swingK);
  const barMs = p.barMinutes * 60_000;
  const htf = aggregate(c, p.htfFactor, barMs);
  const bias = htfBias(htf, p.swingKHtf);
  const htfSize = p.htfFactor * barMs;
  const htfIndex = new Map(htf.map((x, i) => [x.t, i]));
  const biasAt = (i: number): Side | null => {
    // Only higher-timeframe bars that have fully closed before bar i.
    const bucket = Math.floor(c[i].t / htfSize) * htfSize;
    const idx = (htfIndex.get(bucket) ?? 0) - 1;
    return idx >= 0 ? bias[idx] : null;
  };

  const out: Setup[] = [];
  // Pending sweeps waiting for a change of character.
  let longSweep: { at: number; level: number; extreme: number; swingHigh: number } | null = null;
  let shortSweep: { at: number; level: number; extreme: number; swingLow: number } | null = null;
  const sweptLows = new Set<number>();
  const sweptHighs = new Set<number>();
  let hi = 0;
  let lo = 0;
  const visibleHighs: { at: number; level: number }[] = [];
  const visibleLows: { at: number; level: number }[] = [];

  for (let i = 1; i < c.length; i++) {
    while (hi < highs.length && highs[hi].seen <= i) visibleHighs.push(highs[hi++]);
    while (lo < lows.length && lows[lo].seen <= i) visibleLows.push(lows[lo++]);
    const bar = c[i];
    const b = p.useBias ? biasAt(i) : null;
    const hourOk = !p.hours.length || p.hours.includes(new Date(bar.t).getUTCHours());

    // --- sweeps of liquidity ---
    if (!p.useBias || b === "long") {
      for (let k = visibleLows.length - 1; k >= 0; k--) {
        const s = visibleLows[k];
        if (i - s.at > p.sweepLookback) break;
        if (sweptLows.has(s.at)) continue;
        if (bar.l < s.level && bar.c > s.level) {
          sweptLows.add(s.at);
          // The swing high to break is the last one seen before the sweep.
          const sh = visibleHighs.length ? visibleHighs[visibleHighs.length - 1] : null;
          if (sh && sh.level > bar.c) longSweep = { at: i, level: s.level, extreme: bar.l, swingHigh: sh.level };
          break;
        }
      }
    }
    if (!p.useBias || b === "short") {
      for (let k = visibleHighs.length - 1; k >= 0; k--) {
        const s = visibleHighs[k];
        if (i - s.at > p.sweepLookback) break;
        if (sweptHighs.has(s.at)) continue;
        if (bar.h > s.level && bar.c < s.level) {
          sweptHighs.add(s.at);
          const sl = visibleLows.length ? visibleLows[visibleLows.length - 1] : null;
          if (sl && sl.level < bar.c) shortSweep = { at: i, level: s.level, extreme: bar.h, swingLow: sl.level };
          break;
        }
      }
    }

    // A deeper low after the sweep moves the stop; too old sweeps expire.
    if (longSweep) {
      if (i > longSweep.at) longSweep.extreme = Math.min(longSweep.extreme, bar.l);
      if (i - longSweep.at > p.chochWithin) longSweep = null;
    }
    if (shortSweep) {
      if (i > shortSweep.at) shortSweep.extreme = Math.max(shortSweep.extreme, bar.h);
      if (i - shortSweep.at > p.chochWithin) shortSweep = null;
    }

    // --- change of character with displacement, then the gap ---
    const body = Math.abs(bar.c - bar.o);
    if (longSweep && i > longSweep.at && bar.c > longSweep.swingHigh && bar.c > bar.o && body >= p.displacementAtr * a[i]) {
      const sw = longSweep;
      longSweep = null;
      const gap = lastGap(c, sw.at + 1, i, "long");
      if (gap && hourOk && i >= from) {
        const entry = gap.high - (gap.high - gap.low) * p.entryDepth;
        const sl = sw.extreme - p.slBufferAtr * a[i];
        const pct = ((entry - sl) / entry) * 100;
        if (entry > sl && pct >= p.minStopPct && pct <= p.maxStopPct && bar.c > entry) {
          out.push({ side: "long", at: i, time: bar.t, entry, sl, sweep: { at: sw.at, level: sw.level, extreme: sw.extreme }, choch: { at: i, level: sw.swingHigh }, gap, bias: b });
        }
      }
    }
    if (shortSweep && i > shortSweep.at && bar.c < shortSweep.swingLow && bar.c < bar.o && body >= p.displacementAtr * a[i]) {
      const sw = shortSweep;
      shortSweep = null;
      const gap = lastGap(c, sw.at + 1, i, "short");
      if (gap && hourOk && i >= from) {
        const entry = gap.low + (gap.high - gap.low) * p.entryDepth;
        const sl = sw.extreme + p.slBufferAtr * a[i];
        const pct = ((sl - entry) / entry) * 100;
        if (sl > entry && pct >= p.minStopPct && pct <= p.maxStopPct && bar.c < entry) {
          out.push({ side: "short", at: i, time: bar.t, entry, sl, sweep: { at: sw.at, level: sw.level, extreme: sw.extreme }, choch: { at: i, level: sw.swingLow }, gap, bias: b });
        }
      }
    }
  }
  return out;
}

/** The most recent fair value gap in the move between bars `from` and `to` (inclusive). */
function lastGap(c: Candle[], from: number, to: number, side: Side): { at: number; low: number; high: number } | null {
  for (let j = to; j >= Math.max(from, 2); j--) {
    if (side === "long" && c[j].l > c[j - 2].h) return { at: j - 1, low: c[j - 2].h, high: c[j].l };
    if (side === "short" && c[j].h < c[j - 2].l) return { at: j - 1, low: c[j].h, high: c[j - 2].l };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// simulation

export type Fees = { maker: number; taker: number; slippage: number };
/** Binance USDⓈ-M futures, regular tier: 0.02% maker, 0.05% taker; plus slippage on stops. */
export const BINANCE_FEES: Fees = { maker: 0.0002, taker: 0.0005, slippage: 0.0002 };

export type Trade = {
  setup: Setup;
  rr: number;
  outcome: "win" | "loss" | "missed" | "cancelled" | "open";
  filledAt?: number;
  closedAt?: number;
  /** Result in R after fees (1 R = the planned loss). */
  r: number;
};

/**
 * Plays the setups bar by bar with one position per symbol. Conservative: when a bar touches
 * both stop and target, it counts as a loss; a bar that fills the order and touches the stop
 * is a loss too.
 */
export function simulate(c: Candle[], setups: Setup[], rr: number, p: Params = DEFAULT_PARAMS, fees: Fees = BINANCE_FEES): Trade[] {
  const out: Trade[] = [];
  let busyUntil = -1;
  for (const s of setups) {
    if (s.at <= busyUntil) continue;
    const long = s.side === "long";
    const risk = Math.abs(s.entry - s.sl);
    const tp = long ? s.entry + rr * risk : s.entry - rr * risk;
    let filled = -1;
    let trade: Trade = { setup: s, rr, outcome: "cancelled", r: 0 };
    let i = s.at + 1;
    for (; i < c.length; i++) {
      const b = c[i];
      if (filled < 0) {
        if (i - s.at > p.expiry) break;
        // Ran to the target without us, or broke the stop first: cancel.
        if (long ? b.h >= tp && b.l > s.entry : b.l <= tp && b.h < s.entry) {
          trade = { ...trade, outcome: "missed" };
          break;
        }
        if (long ? b.l <= s.entry : b.h >= s.entry) {
          filled = i;
          if (long ? b.l <= s.sl : b.h >= s.sl) break;
          continue;
        }
        if (long ? b.c < s.sl : b.c > s.sl) break;
      } else {
        const hitSl = long ? b.l <= s.sl : b.h >= s.sl;
        const hitTp = long ? b.h >= tp : b.l <= tp;
        if (hitSl || hitTp) break;
      }
    }
    if (filled >= 0) {
      const b = c[Math.min(i, c.length - 1)];
      const end = i >= c.length ? -1 : i;
      const hitSl = end >= 0 && (long ? b.l <= s.sl : b.h >= s.sl);
      const entryFee = s.entry * fees.maker;
      if (end < 0) {
        trade = { ...trade, outcome: "open", filledAt: filled, r: 0 };
      } else if (hitSl) {
        const exitFee = s.sl * (fees.taker + fees.slippage);
        trade = { ...trade, outcome: "loss", filledAt: filled, closedAt: end, r: (-risk - entryFee - exitFee) / risk };
      } else {
        const exitFee = tp * fees.maker;
        trade = { ...trade, outcome: "win", filledAt: filled, closedAt: end, r: (rr * risk - entryFee - exitFee) / risk };
      }
      busyUntil = end < 0 ? c.length : end;
    } else {
      busyUntil = Math.min(c.length, s.at + p.expiry);
    }
    out.push(trade);
  }
  return out;
}

export type Stats = {
  setups: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
  profitFactor: number;
  maxDrawdownR: number;
  longestLosing: number;
  /** Balance after the trades, starting from `start`, risking `riskPct` of the balance each time. */
  balance: number;
  maxDrawdownPct: number;
  perDay: number;
};

export function stats(trades: Trade[], start = 200, riskPct = 1, days = 1): Stats {
  const closed = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
  const wins = closed.filter((t) => t.outcome === "win");
  const totalR = closed.reduce((n, t) => n + t.r, 0);
  const gross = wins.reduce((n, t) => n + t.r, 0);
  const lossR = -closed.filter((t) => t.outcome === "loss").reduce((n, t) => n + t.r, 0);
  let peak = 0;
  let cum = 0;
  let dd = 0;
  let streak = 0;
  let longest = 0;
  let balance = start;
  let peakBal = start;
  let ddPct = 0;
  for (const t of closed) {
    cum += t.r;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
    streak = t.outcome === "loss" ? streak + 1 : 0;
    longest = Math.max(longest, streak);
    balance += balance * (riskPct / 100) * t.r;
    peakBal = Math.max(peakBal, balance);
    ddPct = Math.max(ddPct, ((peakBal - balance) / peakBal) * 100);
  }
  return {
    setups: trades.length,
    trades: closed.length,
    wins: wins.length,
    losses: closed.length - wins.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    avgR: closed.length ? totalR / closed.length : 0,
    totalR,
    profitFactor: lossR ? gross / lossR : gross ? Infinity : 0,
    maxDrawdownR: dd,
    longestLosing: longest,
    balance,
    maxDrawdownPct: ddPct,
    perDay: closed.length / Math.max(1, days),
  };
}

/** Position for a signal: risk `riskPct` of `balance`; size in coins and the notional in USDT. */
export function positionSize(balance: number, riskPct: number, entry: number, sl: number) {
  const riskUsd = balance * (riskPct / 100);
  const qty = riskUsd / Math.abs(entry - sl);
  return { riskUsd, qty, notional: qty * entry, leverageNeeded: (qty * entry) / balance };
}
