import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Khasroy Trading — signal scanner and journal.
// pg_cron calls "scan" every hour with a token from the vault. The scanner:
//   1. reads Telegram updates (/start, /balance, /risk, /stats, /open, /stop) and remembers chats;
//   2. after each 4-hour candle closes, looks for the 100-candle channel breakout on 12 pairs
//      (the rule that held up in the 2022–2026 research; rule.ts, checked against lib/trading/research.ts);
//   3. sends each new signal with entry, stop, target and a position size for the chat's balance;
//   4. follows every open signal on 1-hour candles and reports win / loss in R.
// Signals only: nothing is ever traded from here.

import { breakout, type Candle } from "./rule.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const FAPI = "https://fapi.binance.com";

export const STRATEGY = "4h-donchian100-1.5atr-tp3";
export const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "TRXUSDT", "ATOMUSDT"];
const RR = 3;
const COSTS = { taker: 0.0005, maker: 0.0002, slippage: 0.0002 };
const MAX_DAYS_OPEN = 30;

// The Khasroy Trading site reads market data and the journal straight from here.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
function json(data: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, ...CORS } });
}
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}
const rows = async <T>(path: string): Promise<T[]> => (await (await db(path)).json()) as T[];

async function getState<T>(key: string, fallback: T): Promise<T> {
  const r = await rows<{ value: T }>(`khasroy_trading_state?key=eq.${key}&select=value`);
  return r[0]?.value ?? fallback;
}
async function setState(key: string, value: unknown) {
  await db("khasroy_trading_state", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

// ---------- Binance ----------
async function klines(symbol: string, interval: string, limit: number, startTime?: number): Promise<Candle[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime) q.set("startTime", String(startTime));
  const res = await fetch(`${FAPI}/fapi/v1/klines?${q}`);
  if (!res.ok) throw new Error(`binance ${symbol} ${interval}: ${res.status} ${(await res.text()).slice(0, 120)}`);
  const data = (await res.json()) as unknown[][];
  const now = Date.now();
  // Only closed candles (close time in the past).
  return data.filter((k) => Number(k[6]) < now).map((k) => ({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) }));
}
async function price(symbol: string): Promise<number> {
  const res = await fetch(`${FAPI}/fapi/v1/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`price ${symbol}: ${res.status}`);
  return Number(((await res.json()) as { price: string }).price);
}

// ---------- Telegram ----------
async function tg(method: string, body: Record<string, unknown>) {
  if (!TG) return null;
  const res = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error("telegram", method, res.status, JSON.stringify(data).slice(0, 200));
  return data as { ok: boolean; result?: unknown };
}
const send = (chat: number, text: string) => tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });

type Chat = { chat_id: number; name: string | null; balance: number; risk_pct: number; active: boolean };
type Signal = { id: string; symbol: string; side: "long" | "short"; candle_time: string; entry: number; sl: number; tp: number; status: string; created_at: string; r: number | null; closed_at: string | null; exit_price: number | null };

const fmtP = (n: number) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toPrecision(5));
const fmt = (n: number, d = 2) => n.toFixed(d);
const pair = (s: string) => s.replace("USDT", "/USDT");

async function stats(sinceDays?: number) {
  const since = sinceDays ? `&closed_at=gte.${new Date(Date.now() - sinceDays * 864e5).toISOString()}` : "";
  const closed = await rows<Signal>(`khasroy_trading_signals?strategy=eq.${STRATEGY}&status=in.(win,loss)${since}&select=r,status&order=closed_at.asc`);
  const n = closed.length;
  const wins = closed.filter((s) => s.status === "win").length;
  const total = closed.reduce((a, s) => a + Number(s.r ?? 0), 0);
  let peak = 0, cum = 0, dd = 0;
  for (const s of closed) { cum += Number(s.r ?? 0); peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return { n, wins, total, dd };
}

function statsText(title: string, s: { n: number; wins: number; total: number; dd: number }, risk: number) {
  if (!s.n) return `<b>${title}</b>\nЗакрытых сделок пока нет.`;
  return `<b>${title}</b>\nСделок: ${s.n} · в плюс: ${s.wins} (${fmt((s.wins / s.n) * 100, 0)}%)\nИтог: <b>${s.total >= 0 ? "+" : ""}${fmt(s.total, 1)}R</b> ≈ ${s.total >= 0 ? "+" : ""}${fmt(s.total * risk, 1)}% депозита при риске ${risk}%\nМакс. просадка: ${fmt(s.dd, 1)}R\n\nПо проверке на истории 2022–2026: ~28% сделок в плюс, в среднем +0,07R на сделку, серии до 20–29 убытков подряд.`;
}

const HELP = `<b>Хасрой Трейдинг</b> — сигналы по пробою 100-свечного канала на 4H (12 пар Binance Futures), стоп 1,5 ATR, тейк 1:3.

Команды:
/balance 200 — ваш депозит в USDT (для размера позиции)
/risk 0.5 — риск на сделку в %
/open — открытые сигналы
/stats — статистика журнала
/stop — не присылать сигналы, /start — снова присылать

Это не финансовый совет: решение по каждой сделке за вами. Первые недели лучше смотреть сигналы без реальных денег.`;

async function readUpdates() {
  if (!TG) return 0;
  const offset = await getState<number>("tg_offset", 0);
  const res = await tg("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
  const updates = (res?.result as Array<{ update_id: number; message?: { chat: { id: number; first_name?: string; username?: string }; text?: string } }>) ?? [];
  let next = offset;
  for (const u of updates) {
    next = Math.max(next, u.update_id + 1);
    const m = u.message;
    if (!m?.text) continue;
    const chat = m.chat.id;
    const text = m.text.trim();
    const [cmd, arg] = text.split(/\s+/, 2);
    const existing = (await rows<Chat>(`khasroy_trading_chats?chat_id=eq.${chat}&select=*`))[0];
    if (cmd === "/start" || !existing) {
      await db("khasroy_trading_chats", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ chat_id: chat, name: m.chat.username || m.chat.first_name || null, active: true }) });
      await send(chat, `${HELP}\n\nДепозит: ${existing?.balance ?? 200} USDT, риск ${existing?.risk_pct ?? 0.5}%. Сигналы приходят после закрытия 4-часовой свечи (01:00, 05:00, 09:00, 13:00, 17:00, 21:00 по Бишкеку).`);
      continue;
    }
    if (cmd === "/balance" && Number(arg) > 0) {
      await db(`khasroy_trading_chats?chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ balance: Number(arg) }) });
      await send(chat, `Депозит: ${Number(arg)} USDT.`);
    } else if (cmd === "/risk" && Number(arg) > 0 && Number(arg) <= 5) {
      await db(`khasroy_trading_chats?chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ risk_pct: Number(arg) }) });
      await send(chat, `Риск на сделку: ${Number(arg)}%.${Number(arg) > 1 ? "\nОсторожно: при сериях убытков до 20–29 подряд риск выше 1% даёт очень глубокую просадку." : ""}`);
    } else if (cmd === "/stop") {
      await db(`khasroy_trading_chats?chat_id=eq.${chat}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
      await send(chat, "Сигналы выключены. /start — включить снова.");
    } else if (cmd === "/stats") {
      await send(chat, `${statsText("Весь журнал", await stats(), existing.risk_pct)}\n\n${statsText("За 30 дней", await stats(30), existing.risk_pct)}`);
    } else if (cmd === "/open") {
      const open = await rows<Signal>(`khasroy_trading_signals?strategy=eq.${STRATEGY}&status=eq.open&select=*&order=created_at.asc`);
      await send(chat, open.length ? `<b>Открытые сигналы</b>\n${open.map((s) => `${s.side === "long" ? "🟢 LONG" : "🔴 SHORT"} ${pair(s.symbol)} · вход ${fmtP(+s.entry)} · стоп ${fmtP(+s.sl)} · тейк ${fmtP(+s.tp)}`).join("\n")}` : "Открытых сигналов нет.");
    } else {
      await send(chat, HELP);
    }
  }
  if (next !== offset) await setState("tg_offset", next);
  return updates.length;
}

function signalText(s: Signal, chat: Chat) {
  const risk = Math.abs(s.entry - s.sl);
  const riskUsd = chat.balance * (chat.risk_pct / 100);
  const qty = riskUsd / risk;
  const notional = qty * s.entry;
  const lev = Math.max(1, Math.ceil((notional / chat.balance) * 1.2));
  const pct = (risk / s.entry) * 100;
  return `${s.side === "long" ? "🟢 <b>LONG</b>" : "🔴 <b>SHORT</b>"} <b>${pair(s.symbol)}</b> · 4H пробой канала

Вход: <b>${fmtP(+s.entry)}</b> (по рынку сейчас)
Стоп: ${fmtP(+s.sl)} (${fmt(pct)}%)
Тейк: ${fmtP(+s.tp)} (1:3)

Под ваш депозит ${chat.balance} USDT и риск ${chat.risk_pct}% (−${fmt(riskUsd)} USDT при стопе):
объём ≈ ${qty < 1 ? qty.toPrecision(3) : fmt(qty, qty < 100 ? 2 : 0)} ${s.symbol.replace("USDT", "")} ≈ ${fmt(notional, 0)} USDT, плечо от ×${lev}

Ставьте стоп и тейк сразу при входе. Не финансовый совет.`;
}

async function broadcast(text: (chat: Chat) => string) {
  const chats = await rows<Chat>("khasroy_trading_chats?active=eq.true&select=*");
  for (const c of chats) await send(c.chat_id, text(c));
  return chats.length;
}

// ---------- the scan ----------
async function scan() {
  const report: Record<string, unknown> = {};
  report.updates = await readUpdates();

  // 1) Follow open signals on 1h candles.
  const open = await rows<Signal>(`khasroy_trading_signals?strategy=eq.${STRATEGY}&status=eq.open&select=*`);
  const closedNow: Signal[] = [];
  for (const s of open) {
    const from = Date.parse(s.created_at);
    const hours = await klines(s.symbol, "1h", 1000, from - 3_600_000);
    const long = s.side === "long";
    let done: { status: string; exit: number; at: number } | null = null;
    for (const k of hours.filter((k) => k.t + 3_600_000 > from)) {
      const hitSl = long ? k.l <= +s.sl : k.h >= +s.sl;
      const hitTp = long ? k.h >= +s.tp : k.l <= +s.tp;
      if (hitSl) { done = { status: "loss", exit: +s.sl, at: k.t }; break; }
      if (hitTp) { done = { status: "win", exit: +s.tp, at: k.t }; break; }
    }
    if (!done && Date.now() - from > MAX_DAYS_OPEN * 864e5) done = { status: "expired", exit: hours[hours.length - 1]?.c ?? +s.entry, at: Date.now() };
    if (done) {
      const risk = Math.abs(+s.entry - +s.sl);
      const gross = long ? done.exit - +s.entry : +s.entry - done.exit;
      const fee = +s.entry * (COSTS.taker + COSTS.slippage) + done.exit * (done.status === "win" ? COSTS.maker : COSTS.taker + COSTS.slippage);
      const r = (gross - fee) / risk;
      await db(`khasroy_trading_signals?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ status: done.status, exit_price: done.exit, r, closed_at: new Date(done.at).toISOString() }) });
      closedNow.push({ ...s, status: done.status, r, exit_price: done.exit });
    }
  }
  if (closedNow.length) {
    const total = await stats();
    await broadcast((c) => closedNow.map((s) => `${s.status === "win" ? "✅ Тейк" : s.status === "loss" ? "❌ Стоп" : "⏹ Закрыт по времени"} · ${pair(s.symbol)} ${s.side.toUpperCase()} · ${(s.r ?? 0) >= 0 ? "+" : ""}${fmt(s.r ?? 0)}R (${(s.r ?? 0) >= 0 ? "+" : ""}${fmt((s.r ?? 0) * c.risk_pct)}% депозита)`).join("\n") + `\n\nЖурнал: ${total.n} сделок, ${total.total >= 0 ? "+" : ""}${fmt(total.total, 1)}R`);
  }
  report.closed = closedNow.length;

  // 2) New 4h candle closed? Look for breakouts.
  const lastBar = await getState<Record<string, number>>("last_bar", {});
  const fresh: Signal[] = [];
  const openSymbols = new Set(open.filter((s) => !closedNow.find((c) => c.id === s.id)).map((s) => s.symbol));
  for (const symbol of PAIRS) {
    try {
      const c = await klines(symbol, "4h", 300);
      if (c.length < 150) continue;
      const last = c.length - 1;
      if (lastBar[symbol] === c[last].t) continue;
      lastBar[symbol] = c[last].t;
      if (openSymbols.has(symbol)) continue; // one position per pair, as in the research
      const sig = breakout(c, last);
      if (!sig) continue;
      // The research enters at the next candle's open: that is the price right now.
      const entry = await price(symbol);
      const risk = sig.risk;
      const long = sig.side === "long";
      // Already ran past where a target would be, or back through the stop: skip.
      if (long ? entry <= c[last].c - risk : entry >= c[last].c + risk) continue;
      const sl = long ? entry - risk : entry + risk;
      const tp = long ? entry + RR * risk : entry - RR * risk;
      const row = { strategy: STRATEGY, symbol, side: sig.side, candle_time: new Date(c[last].t).toISOString(), entry, sl, tp };
      const ins = await (await db("khasroy_trading_signals?on_conflict=strategy,symbol,candle_time", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row) })).json();
      if (Array.isArray(ins) && ins[0]) fresh.push(ins[0] as Signal);
    } catch (error) {
      console.error("scan", symbol, error);
      report[`error_${symbol}`] = String(error).slice(0, 160);
    }
  }
  await setState("last_bar", lastBar);
  for (const s of fresh) await broadcast((c) => signalText(s, c));
  report.signals = fresh.map((s) => `${s.side} ${s.symbol}`);

  // 3) Weekly summary on Monday after the 01:00 UTC run... once a week.
  const week = Math.floor(Date.now() / (7 * 864e5));
  if ((await getState<number>("summary_week", 0)) !== week && new Date().getUTCDay() === 1) {
    await setState("summary_week", week);
    const all = await stats();
    const last7 = await stats(7);
    await broadcast((c) => `📊 <b>Неделя Хасрой Трейдинг</b>\n\n${statsText("За 7 дней", last7, c.risk_pct)}\n\n${statsText("Весь журнал", all, c.risk_pct)}`);
  }
  return report;
}

// ---------- public read-only data for the site ----------
async function publicAction(body: Record<string, unknown>): Promise<Response | null> {
  if (body.action === "klines") {
    // Candles for the chart, including the one still forming (flag "x": closed).
    const symbol = String(body.symbol ?? "");
    const interval = String(body.interval ?? "");
    if (!PAIRS.includes(symbol) || !INTERVALS.includes(interval)) return json({ error: "bad_symbol_or_interval" }, 400);
    const limit = Math.max(10, Math.min(1500, Number(body.limit) || 500));
    const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (Number(body.endTime) > 0) q.set("endTime", String(Number(body.endTime)));
    const res = await fetch(`${FAPI}/fapi/v1/klines?${q}`);
    if (!res.ok) return json({ error: `binance ${res.status}` }, 502);
    const now = Date.now();
    const data = ((await res.json()) as unknown[][]).map((k) => [Number(k[0]), Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5]), Number(k[6]) < now ? 1 : 0]);
    return json({ symbol, interval, candles: data }, 200, "public, max-age=5");
  }
  if (body.action === "market") {
    // Price, 24h change and funding for the 12 pairs.
    const [tick, prem] = await Promise.all([
      fetch(`${FAPI}/fapi/v1/ticker/24hr`).then((r) => r.json()) as Promise<Array<Record<string, string>>>,
      fetch(`${FAPI}/fapi/v1/premiumIndex`).then((r) => r.json()) as Promise<Array<Record<string, string | number>>>,
    ]);
    const out = PAIRS.map((symbol) => {
      const t = tick.find((x) => x.symbol === symbol);
      const p = prem.find((x) => x.symbol === symbol);
      return { symbol, price: Number(t?.lastPrice), change: Number(t?.priceChangePercent), volume: Number(t?.quoteVolume), funding: Number(p?.lastFundingRate), nextFunding: Number(p?.nextFundingTime) };
    });
    return json({ pairs: out, time: Date.now() }, 200, "public, max-age=5");
  }
  if (body.action === "journal") {
    const signals = await rows<Signal>(`khasroy_trading_signals?strategy=eq.${STRATEGY}&select=id,symbol,side,candle_time,entry,sl,tp,status,exit_price,r,closed_at,created_at&order=created_at.desc&limit=300`);
    return json({ strategy: STRATEGY, pairs: PAIRS, signals, time: Date.now() }, 200, "public, max-age=20");
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "GET") return json({ ok: true, service: "khasroy-trading", strategy: STRATEGY, telegram: Boolean(TG) });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pub = await publicAction(body);
    if (pub) return pub;
    if (body.action === "probe") {
      // Public: shows whether Binance answers from here, nothing else.
      const t0 = Date.now();
      const c = await klines("BTCUSDT", "4h", 5).catch((e) => String(e));
      // Which bot the token belongs to and whether messages are waiting (public facts about the bot).
      const me = TG ? ((await tg("getMe", {}))?.result as { username?: string } | undefined) : undefined;
      const hook = TG ? ((await tg("getWebhookInfo", {}))?.result as { url?: string; pending_update_count?: number } | undefined) : undefined;
      return json({ ok: Array.isArray(c), ms: Date.now() - t0, sample: Array.isArray(c) ? c[c.length - 1] : c, telegram: Boolean(TG), bot: me?.username ?? null, webhook: Boolean(hook?.url), pending: hook?.pending_update_count ?? null });
    }
    const token = req.headers.get("x-khasroy-trading-token") ?? "";
    const check = await (await db("rpc/khasroy_trading_token_ok", { method: "POST", body: JSON.stringify({ token }) })).json();
    if (check !== true) return json({ error: "unauthorized" }, 401);
    if (body.action === "scan") return json({ ok: true, ...(await scan()) });
    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("khasroy-trading", error);
    return json({ error: String(error).slice(0, 300) }, 500);
  }
});
