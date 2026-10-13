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
  /** Notes Khasroy pins to the chart, each with an arrow to a candle (t = 4h candle open, ms). */
  callouts: Callout[];
};

export type Callout = { id: string; t: number; price: number; text: string; place: "above" | "below" | "left" };

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

  let hiAt = n - CHANNEL;
  let loAt = n - CHANNEL;
  for (let k = n - CHANNEL; k < n; k++) {
    if (c4h[k].h >= c4h[hiAt].h) hiAt = k;
    if (c4h[k].l <= c4h[loAt].l) loAt = k;
  }
  const callouts: Callout[] = [
    { id: "hi", t: c4h[hiAt].t, price: hi, place: "above", text: `Самая высокая цена за 16 дней: ${f(hi)}. Закроется 4-часовая свеча выше — Хасрой купит.` },
    { id: "lo", t: c4h[loAt].t, price: lo, place: "below", text: `Самая низкая цена за 16 дней: ${f(lo)}. Закроется ниже — Хасрой продаст.` },
    { id: "now", t: c4h[n - 1].t, price, place: "left", text: `Сейчас ${f(price)}. До покупки ${upPct.toFixed(1)}% вверх, до продажи ${downPct.toFixed(1)}% вниз.` },
  ];

  return {
    callouts,
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

// ---------------------------------------------------------------------------------------------
// trades on the chart: the "long / short position" boxes with Khasroy's comment

export type ChartTrade = {
  id: string;
  side: Side;
  /** Candle open times (ms): the signal candle, the entry and the exit (null while open). */
  signalT: number;
  entryT: number;
  exitT: number | null;
  entry: number;
  sl: number;
  tp: number;
  exit: number | null;
  status: "win" | "loss" | "open";
  live: boolean;
};

/** The live rule on 4h candles (same simulator as the past check), plus the trade still open. */
export function chartTrades(c: Candle[]): ChartTrade[] {
  if (c.length < CHANNEL + 20) return [];
  const rule = donchian(CHANNEL, STOP_ATR, { kind: "target", rr: RR });
  const { signals } = rule.build(c);
  const riskAt = new Map(signals.map((x) => [x.at, x.risk]));
  const out: ChartTrade[] = [];
  let free = 0;
  for (const t of run(c, signals, rule.exit, 4)) {
    const risk = riskAt.get(t.entryAt - 1) ?? 0;
    const long = t.side === "long";
    out.push({
      id: `h${c[t.entryAt].t}`, side: t.side, signalT: c[t.entryAt - 1].t, entryT: c[t.entryAt].t, exitT: c[t.exitAt].t,
      entry: t.entry, sl: long ? t.entry - risk : t.entry + risk, tp: long ? t.entry + RR * risk : t.entry - RR * risk,
      exit: t.exit, status: t.r > 0 ? "win" : "loss", live: false,
    });
    free = t.exitAt + 1;
  }
  // The simulator stops at a trade that has not finished yet: show it as open.
  const next = signals.find((x) => x.at >= free && x.at + 1 < c.length);
  if (next) {
    const long = next.side === "long";
    const entry = c[next.at + 1].o;
    out.push({
      id: `h${c[next.at + 1].t}`, side: next.side, signalT: c[next.at].t, entryT: c[next.at + 1].t, exitT: null,
      entry, sl: long ? entry - next.risk : entry + next.risk, tp: long ? entry + RR * next.risk : entry - RR * next.risk,
      exit: null, status: "open", live: false,
    });
  }
  return out;
}

/** A journal signal as a chart trade. */
export function journalTrade(s: JournalSignal): ChartTrade {
  const entryT = Math.floor(Date.parse(s.created_at) / 144e5) * 144e5;
  return {
    id: s.id, side: s.side, signalT: entryT - 144e5, entryT,
    exitT: s.closed_at && s.status !== "open" ? Math.floor(Date.parse(s.closed_at) / 144e5) * 144e5 : null,
    entry: s.entry, sl: s.sl, tp: s.tp,
    exit: s.status === "win" ? s.tp : s.status === "loss" ? s.sl : null,
    status: s.status === "win" ? "win" : s.status === "open" ? "open" : "loss",
    live: true,
  };
}

const dur = (ms: number) => { const h = Math.max(4, Math.round(ms / 36e5)); return h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн.`; };

/** Khasroy's words about a trade: why he went in, what he expects, and how it went. */
export function tradeStory(c: Candle[], t: ChartTrade, price: number, now = Date.now()) {
  const long = t.side === "long";
  const i = c.findIndex((x) => x.t === t.signalT);
  let why: string;
  let whyShort = long ? "цена закрылась выше коридора 16 дней" : "цена закрылась ниже коридора 16 дней";
  if (i >= CHANNEL) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - CHANNEL; k < i; k++) { hi = Math.max(hi, c[k].h); lo = Math.min(lo, c[k].l); }
    const closes = c.slice(0, i + 1).map((x) => x.c);
    const e50 = ema(closes, 50)[i];
    const e200 = ema(closes, 200)[i];
    const trend = e50 > e200 * 1.005 ? "up" : e50 < e200 * 0.995 ? "down" : "flat";
    why = long
      ? `4-часовая свеча закрылась на ${f(c[i].c)} — выше самой высокой цены за 16 дней (${f(hi)}). Покупатели пробили потолок, цена может пойти дальше вверх.`
      : `4-часовая свеча закрылась на ${f(c[i].c)} — ниже самой низкой цены за 16 дней (${f(lo)}). Продавцы пробили пол, цена может пойти дальше вниз.`;
    whyShort = `${long ? `пробила потолок 16 дней (${f(hi)})` : `пробила пол 16 дней (${f(lo)})`}${trend === (long ? "up" : "down") ? ", по течению рынка" : trend === "flat" ? "" : ", против течения"}`;
    why += trend === (long ? "up" : "down") ? " Общее направление рынка такое же — сделка по течению." : trend === "flat" ? " Явного общего направления не было." : " Но общее направление рынка обратное — сделка против течения, риск выше.";
  } else why = long ? "Цена закрылась выше коридора последних 16 дней — Хасрой покупает." : "Цена закрылась ниже коридора последних 16 дней — Хасрой продаёт.";
  const tpPct = Math.abs(pct(t.tp, t.entry));
  const slPct = Math.abs(pct(t.sl, t.entry));
  const expect = `Ждёт ${long ? "рост" : "падение"} до ${f(t.tp)} (${long ? "+" : "−"}${tpPct.toFixed(1)}%). Если цена ${long ? "упадёт" : "вырастет"} до ${f(t.sl)} (${slPct.toFixed(1)}%), выйдет с маленьким убытком. Возможная прибыль в 3 раза больше риска.`;
  let result: string;
  let progress = 0;
  if (t.status === "win") { result = `✅ Прогноз сбылся: через ${dur((t.exitT ?? now) - t.entryT)} цена дошла до цели.`; progress = 1; }
  else if (t.status === "loss") { result = `❌ Не сбылось: через ${dur((t.exitT ?? now) - t.entryT)} цена ушла к стопу — небольшой убыток.`; progress = -1; }
  else {
    const move = long ? price - t.entry : t.entry - price;
    progress = move >= 0 ? Math.min(1, move / Math.abs(t.tp - t.entry)) : Math.max(-1, move / Math.abs(t.entry - t.sl));
    result = `⏳ Сделка идёт ${dur(now - t.entryT)}. Сейчас ${move >= 0 ? "+" : "−"}${Math.abs((move / t.entry) * 100).toFixed(2)}% от входа: ${move >= 0 ? `пройдено ${Math.round(progress * 100)}% пути до цели` : `до стопа осталось ${Math.round((1 + progress) * 100)}% пути`}.`;
  }
  const expectShort = `цель ${f(t.tp)} (${long ? "+" : "−"}${tpPct.toFixed(1)}%), стоп ${f(t.sl)} (${long ? "−" : "+"}${slPct.toFixed(1)}%)`;
  return { why, whyShort, expect, expectShort, result, progress };
}
