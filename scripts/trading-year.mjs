// Khasroy's live rule replayed from 1 January 2026 to today: a $1000 wallet that takes every signal.
// Same simulator, fees and slippage as the site; trades are compounded in the order they were entered.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { aggregate } from "../lib/trading/smc.ts";
import { donchian, run } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const FROM = Date.parse("2026-01-01T00:00:00Z");
const START = 1000;

function load(symbol) {
  const rows = [];
  for (const f of readdirSync(DATA_DIR).filter((f) => f.startsWith(`${symbol}-1h-`) && f.endsWith(".csv")).sort()) {
    for (const line of readFileSync(join(DATA_DIR, f), "utf8").split("\n")) {
      const p = line.split(",");
      const t = Number(p[0]);
      if (!Number.isFinite(t) || p.length < 6) continue;
      rows.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
}

const symbols = [...new Set(readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv")).map((f) => f.split("-")[0]))].sort();
const CORE = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "TRXUSDT", "ATOMUSDT"];
const data = Object.fromEntries(symbols.map((s) => [s, load(s)]));
// Only pairs with data from before 2026 (warm-up for the 100-candle corridor).
const usable = symbols.filter((s) => data[s].length && data[s][0].t < FROM - 40 * 864e5);
const lastT = Math.max(...usable.map((s) => data[s][data[s].length - 1].t));
const days = (lastT - FROM) / 864e5;
const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function replay(label, pairs, hours) {
  const rule = donchian(100, 1.5, { kind: "target", rr: 3 });
  const trades = [];
  let openR = 0;
  for (const s of pairs) {
    const c = hours === 1 ? data[s] : aggregate(data[s], hours, 3_600_000);
    const { signals } = rule.build(c);
    const done = run(c, signals, rule.exit, hours);
    for (const t of done) if (t.time >= FROM) trades.push(t);
    const free = done.length ? done[done.length - 1].exitAt + 1 : 0;
    const nx = signals.find((x) => x.at >= free && x.at + 1 < c.length);
    if (nx && c[nx.at + 1].t >= FROM) {
      const entry = c[nx.at + 1].o;
      const last = c[c.length - 1].c;
      openR += (nx.side === "long" ? last - entry : entry - last) / nx.risk;
    }
  }
  trades.sort((a, b) => a.time - b.time);
  const wins = trades.filter((t) => t.r > 0).length;
  const out = [`${label}: ${pairs.length} pairs, ${trades.length} trades = ${(trades.length / days).toFixed(1)}/day, win ${((wins / trades.length) * 100).toFixed(0)}%, total ${trades.reduce((n, t) => n + t.r, 0).toFixed(1)}R, avg ${(trades.reduce((n, t) => n + t.r, 0) / trades.length).toFixed(3)}R`];
  for (const risk of [0.5, 1]) {
    let v = START, peak = START, dd = 0;
    const months = new Map();
    for (const t of trades) {
      const pnl = v * (risk / 100) * t.r;
      v += pnl; peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak);
      const m = new Date(t.time).toISOString().slice(5, 7);
      months.set(m, v);
    }
    out.push(`  ${risk}%: $1000 → $${fmt(v)} (+open ${(openR * risk / 100 * v).toFixed(0)}) dd ${(dd * 100).toFixed(0)}% | months: ${[...months].map(([m, x]) => `${m}:${fmt(x)}`).join(" ")}`);
  }
  return out;
}

const lines = [`data until ${new Date(lastT).toISOString().slice(0, 16)}Z, ${days.toFixed(0)} days; usable pairs ${usable.length}: ${usable.map((s) => s.replace("USDT", "")).join(" ")}`];
const core = CORE.filter((s) => usable.includes(s));
lines.push(...replay("A 4h, 12 core pairs (current)", core, 4));
lines.push(...replay("B 4h, all pairs", usable, 4));
lines.push(...replay("C 1h, 12 core pairs", core, 1));
lines.push(...replay("D 1h, all pairs", usable, 1));
const extra = usable.filter((s) => !CORE.includes(s));
lines.push(...replay("E 4h, only the extra pairs", extra, 4));
console.log(`::notice title=2026 replay::${lines.join(" %0A")}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n\n") + "\n");
