// Khasroy Trading — what the site says about a pair, and the paper wallet.
// Everything is computed from candles by fixed rules, so every sentence can be checked on the chart.

import type { Candle, Side } from "./smc.ts";
import { atr } from "./smc.ts";
import { donchian, ema, run, type RTrade } from "./research.ts";

export const CHANNEL = 100;
export const STOP_ATR = 1.5;
export const RR = 3;

export type Analysis = {
  price: number;
  /** Levels whose close beyond them gives the next signal. */
  breakoutHigh: number;
  breakoutLow: number;
  distHighPct: number;
  distLowPct: number;
  distHighAtr: number;
  distLowAtr: number;
  atr: number;
  atrPct: number;
  volatility: "низкая" | "обычная" | "высокая";
  trend: "вверх" | "вниз" | "боковик";
  ema50: number;
  ema200: number;
  change7d: number;
  funding: number | null;
  /** The side the price is closer to breaking, and how close (0..1, 1 = at the level). */
  nearest: { side: Side; closeness: number };
  /** What a signal would look like right now if the candle closed beyond the level. */
  plan: { long: { entry: number; sl: number; tp: number }; short: { entry: number; sl: number; tp: number } };
  verdict: string;
  points: { tone: "plus" | "minus" | "note"; text: string }[];
};

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const f = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : Math.abs(n) >= 1 ? n.toFixed(3) : n.toPrecision(4));

/**
 * Analysis from closed 4-hour candles (oldest first) and the live price.
 * The breakout levels are those the NEXT candle close has to beat.
 */
export function analyze(c4h: Candle[], price: number, funding: number | null = null): Analysis | null {
  if (c4h.length < CHANNEL + 50) return null;
  const n = c4h.length;
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = n - CHANNEL; k < n; k++) {
    hi = Math.max(hi, c4h[k].h);
    lo = Math.min(lo, c4h[k].l);
  }
  const a = atr(c4h)[n - 1];
  const atrs = atr(c4h).slice(-100).sort((x, y) => x - y);
  const median = atrs[Math.floor(atrs.length / 2)];
  const closes = c4h.map((x) => x.c);
  const e50 = ema(closes, 50)[n - 1];
  const e200 = ema(closes, 200)[n - 1];
  const change7d = pct(price, c4h[Math.max(0, n - 42)].c);
  const trend = e50 > e200 * 1.005 && price > e50 ? "вверх" : e50 < e200 * 0.995 && price < e50 ? "вниз" : "боковик";
  const volatility = a > median * 1.3 ? "высокая" : a < median * 0.75 ? "низкая" : "обычная";
  const distHighAtr = (hi - price) / a;
  const distLowAtr = (price - lo) / a;
  const nearest: Analysis["nearest"] = distHighAtr <= distLowAtr
    ? { side: "long", closeness: Math.max(0, Math.min(1, 1 - distHighAtr / 6)) }
    : { side: "short", closeness: Math.max(0, Math.min(1, 1 - distLowAtr / 6)) };
  const risk = STOP_ATR * a;
  const plan = {
    long: { entry: hi, sl: hi - risk, tp: hi + RR * risk },
    short: { entry: lo, sl: lo + risk, tp: lo - RR * risk },
  };

  const points: Analysis["points"] = [];
  const close = Math.min(distHighAtr, distLowAtr);
  const upPct = pct(hi, price);
  const downPct = pct(price, lo);
  const nearPct = nearest.side === "long" ? upPct : downPct;
  let verdict: string;
  if (price > hi) verdict = `Цена вышла выше коридора (${f(hi)}). Если 4-часовая свеча так и закроется — Хасрой даст сигнал на покупку (LONG).`;
  else if (price < lo) verdict = `Цена вышла ниже коридора (${f(lo)}). Если 4-часовая свеча так и закроется — Хасрой даст сигнал на продажу (SHORT).`;
  else if (close < 1) verdict = `Почти сигнал! Цена в шаге от ${nearest.side === "long" ? `верха коридора (${f(hi)}) — может быть покупка` : `низа коридора (${f(lo)}) — может быть продажа`}. Ждём закрытия 4-часовой свечи.`;
  else if (close < 3) verdict = `Сейчас не входим. Цена подходит к ${nearest.side === "long" ? `верху коридора — до ${f(hi)} осталось ${nearPct.toFixed(1)}%` : `низу коридора — до ${f(lo)} осталось ${nearPct.toFixed(1)}%`}.`;
  else verdict = `Сейчас не входим — ждём. Цена ходит внутри коридора, до выхода далеко (вверх ${upPct.toFixed(1)}%, вниз ${downPct.toFixed(1)}%).`;

  points.push({ tone: "note", text: `Как работает Хасрой: последние ~16 дней цена ходила между ${f(lo)} и ${f(hi)} (это «коридор»). Сделка — только когда цена из него выходит: выше — покупка, ниже — продажа.` });
  if (trend === "вверх") points.push({ tone: nearest.side === "long" ? "plus" : "minus", text: `Общее направление рынка — вверх. Покупки по такому течению в прошлом срабатывали чаще.` });
  else if (trend === "вниз") points.push({ tone: nearest.side === "short" ? "plus" : "minus", text: `Общее направление рынка — вниз. Продажи по такому течению в прошлом срабатывали чаще.` });
  else points.push({ tone: "note", text: `Явного направления нет, рынок топчется на месте. В такое время чаще бывают ложные выходы из коридора.` });
  const stopPct = (risk / price) * 100;
  points.push({
    tone: volatility === "высокая" ? "minus" : "note",
    text: `Рынок двигается ${volatility === "высокая" ? "резко" : volatility === "низкая" ? "спокойно" : "как обычно"}: за 4 часа цена обычно проходит ~${((a / price) * 100).toFixed(1)}%. Поэтому защитный выход (стоп) будет примерно в ${stopPct.toFixed(1)}% от входа.${volatility === "высокая" ? " При резком рынке сумма сделки меньше, чтобы риск остался тем же." : ""}`,
  });
  points.push({ tone: change7d > 0 ? (nearest.side === "long" ? "plus" : "note") : nearest.side === "short" ? "plus" : "note", text: `За неделю цена ${change7d >= 0 ? "выросла" : "упала"} на ${Math.abs(change7d).toFixed(1)}%.` });
  if (funding !== null && Number.isFinite(funding)) {
    const fp = funding * 100;
    points.push({
      tone: Math.abs(fp) > 0.03 ? "minus" : "note",
      text: fp > 0.03 ? "Покупателей сейчас слишком много — они доплачивают продавцам. Такой перекос часто кончается откатом вниз." : fp < -0.03 ? "Продавцов сейчас слишком много — они доплачивают покупателям. Такой перекос часто кончается отскоком вверх." : "Перекоса между покупателями и продавцами нет — спокойно.",
    });
  }
  points.push({ tone: "note", text: `План, если будет покупка: вход ≈ ${f(plan.long.entry)}, стоп ${f(plan.long.sl)} (выходим с небольшим убытком), цель ${f(plan.long.tp)} (прибыль в 3 раза больше риска). Если продажа: вход ≈ ${f(plan.short.entry)}, стоп ${f(plan.short.sl)}, цель ${f(plan.short.tp)}.` });

  return {
    price,
    breakoutHigh: hi,
    breakoutLow: lo,
    distHighPct: pct(hi, price),
    distLowPct: pct(price, lo),
    distHighAtr,
    distLowAtr,
    atr: a,
    atrPct: (a / price) * 100,
    volatility,
    trend,
    ema50: e50,
    ema200: e200,
    change7d,
    funding,
    nearest,
    plan,
    verdict,
    points,
  };
}

// ---------------------------------------------------------------------------------------------
// paper wallet

export type JournalSignal = {
  id: string;
  symbol: string;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
  status: "open" | "win" | "loss" | "expired";
  r: number | null;
  created_at: string;
  closed_at: string | null;
};

export type WalletTrade = JournalSignal & { riskUsd: number; pnl: number; open: boolean };

/**
 * A pretend account: starts with `start` USDT and takes every signal with `riskPct` of the
 * balance at entry. Closed trades realise r × risk; open ones are marked at the live price.
 */
export function paperWallet(signals: JournalSignal[], start: number, riskPct: number, prices: Record<string, number>) {
  const events: { t: number; kind: "open" | "close"; s: JournalSignal }[] = [];
  for (const s of signals) {
    events.push({ t: Date.parse(s.created_at), kind: "open", s });
    if (s.status !== "open" && s.closed_at) events.push({ t: Date.parse(s.closed_at), kind: "close", s });
  }
  events.sort((a, b) => a.t - b.t || (a.kind === "close" ? -1 : 1));
  let balance = start;
  const risk = new Map<string, number>();
  const curve: { t: number; v: number }[] = [];
  const trades: WalletTrade[] = [];
  for (const e of events) {
    if (e.kind === "open") risk.set(e.s.id, balance * (riskPct / 100));
    else {
      const pnl = (e.s.r ?? 0) * (risk.get(e.s.id) ?? 0);
      balance += pnl;
      curve.push({ t: e.t, v: balance });
    }
  }
  let unrealized = 0;
  for (const s of signals) {
    const riskUsd = risk.get(s.id) ?? 0;
    if (s.status === "open") {
      const p = prices[s.symbol];
      const move = p ? (s.side === "long" ? p - s.entry : s.entry - p) / Math.abs(s.entry - s.sl) : 0;
      const pnl = move * riskUsd;
      unrealized += pnl;
      trades.push({ ...s, riskUsd, pnl, open: true });
    } else trades.push({ ...s, riskUsd, pnl: (s.r ?? 0) * riskUsd, open: false });
  }
  const closed = signals.filter((s) => s.status === "win" || s.status === "loss");
  const wins = closed.filter((s) => s.status === "win").length;
  let peak = start;
  let dd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.v);
    dd = Math.max(dd, (peak - p.v) / peak);
  }
  return {
    start,
    balance,
    equity: balance + unrealized,
    unrealized,
    curve,
    trades: trades.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    closed: closed.length,
    wins,
    totalR: closed.reduce((n, s) => n + (s.r ?? 0), 0),
    maxDrawdownPct: dd * 100,
  };
}

// ---------------------------------------------------------------------------------------------
// the same rule on recent history, for the "как было бы" panel

/** Trades of the live rule on each pair's 4h candles, merged in time. */
export function historyTrades(series: Record<string, Candle[]>): (RTrade & { symbol: string })[] {
  const rule = donchian(CHANNEL, STOP_ATR, { kind: "target", rr: RR });
  const out: (RTrade & { symbol: string })[] = [];
  for (const [symbol, c] of Object.entries(series)) {
    if (c.length < CHANNEL + 20) continue;
    for (const t of run(c, rule.build(c).signals, rule.exit, 4)) out.push({ ...t, symbol });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Balance path of a pretend account over the trades (risk % of the balance each time). */
export function equityPath(trades: { time: number; r: number }[], start: number, riskPct: number) {
  let v = start;
  let peak = start;
  let dd = 0;
  const path = [{ t: trades[0]?.time ?? Date.now(), v }];
  for (const t of trades) {
    v += v * (riskPct / 100) * t.r;
    peak = Math.max(peak, v);
    dd = Math.max(dd, (peak - v) / peak);
    path.push({ t: t.time, v });
  }
  const wins = trades.filter((t) => t.r > 0).length;
  return { path, end: v, maxDrawdownPct: dd * 100, trades: trades.length, winRate: trades.length ? wins / trades.length : 0, totalR: trades.reduce((n, t) => n + t.r, 0) };
}
