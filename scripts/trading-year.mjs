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
const rule = donchian(100, 1.5, { kind: "target", rr: 3 });
const trades = [];
const open = [];
let lastT = 0;
for (const s of symbols) {
  const h1 = load(s);
  lastT = Math.max(lastT, h1[h1.length - 1].t);
  const c = aggregate(h1, 4, 3_600_000);
  const { signals } = rule.build(c);
  const done = run(c, signals, rule.exit, 4);
  for (const t of done) if (t.time >= FROM) trades.push({ ...t, sym: s.replace("USDT", ""), exitTime: c[t.exitAt].t });
  const free = done.length ? done[done.length - 1].exitAt + 1 : 0;
  const nx = signals.find((x) => x.at >= free && x.at + 1 < c.length);
  if (nx && c[nx.at + 1].t >= FROM) {
    const entry = c[nx.at + 1].o;
    const last = c[c.length - 1].c;
    const move = (nx.side === "long" ? last - entry : entry - last) / nx.risk;
    open.push({ sym: s.replace("USDT", ""), side: nx.side, time: c[nx.at + 1].t, r: move });
  }
}
trades.sort((a, b) => a.time - b.time);

const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const lines = [];
for (const risk of [0.5, 1, 2]) {
  let v = START, peak = START, dd = 0;
  const months = new Map();
  for (const t of trades) {
    const pnl = v * (risk / 100) * t.r;
    v += pnl;
    peak = Math.max(peak, v);
    dd = Math.max(dd, 1 - v / peak);
    const m = new Date(t.time).toISOString().slice(0, 7);
    const x = months.get(m) ?? { n: 0, w: 0, pnl: 0, end: 0 };
    x.n++; if (t.r > 0) x.w++; x.pnl += pnl; x.end = v;
    months.set(m, x);
  }
  const openPnl = open.reduce((n, o) => n + v * (risk / 100) * o.r, 0);
  const wins = trades.filter((t) => t.r > 0).length;
  lines.push(`RISK ${risk}%: $${START} → $${fmt(v)} closed (${v >= START ? "+" : ""}${(((v - START) / START) * 100).toFixed(1)}%), open trades ${openPnl >= 0 ? "+" : ""}$${fmt(openPnl)} → equity $${fmt(v + openPnl)} | ${trades.length} trades, ${wins} wins (${((wins / trades.length) * 100).toFixed(0)}%), ${trades.length - wins} losses | max drawdown ${(dd * 100).toFixed(1)}%`);
  lines.push("  " + [...months].map(([m, x]) => `${m}: ${x.n}tr ${x.w}w ${x.pnl >= 0 ? "+" : ""}$${fmt(x.pnl)} → $${fmt(x.end)}`).join(" | "));
}
const bySym = {};
for (const t of trades) (bySym[t.sym] ??= { n: 0, r: 0 }), bySym[t.sym].n++, (bySym[t.sym].r += t.r);
lines.push("by pair (R): " + Object.entries(bySym).map(([s, x]) => `${s} ${x.n}tr ${x.r >= 0 ? "+" : ""}${x.r.toFixed(1)}R`).join(", "));
lines.push("total R: " + trades.reduce((n, t) => n + t.r, 0).toFixed(1));
lines.push("open now: " + (open.map((o) => `${o.sym} ${o.side} since ${new Date(o.time).toISOString().slice(0, 10)} ${o.r >= 0 ? "+" : ""}${o.r.toFixed(2)}R`).join(", ") || "none"));
lines.push(`data until ${new Date(lastT).toISOString().slice(0, 16)}Z; pairs ${symbols.length}`);
const best = [...trades].sort((a, b) => b.r - a.r).slice(0, 3).map((t) => `${t.sym} ${t.side} ${new Date(t.time).toISOString().slice(0, 10)} ${t.r.toFixed(2)}R`);
lines.push("best: " + best.join(", "));
console.log(`::notice title=2026 replay::${lines.join(" %0A")}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n\n") + "\n");
