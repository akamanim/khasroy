// Backtest of the Smart Money rules (lib/trading/smc.ts) on Binance USDⓈ-M futures 5m candles.
// Data: monthly CSV files from data.binance.vision, unpacked into DATA_DIR (see the workflow).
// Prints a summary table and writes it to the GitHub job summary and as annotations.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PARAMS, aggregate, findSetups, simulate, stats } from "../lib/trading/smc.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const VARIANTS = (process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : null) ?? [
  { name: "base" },
  { name: "no-bias", useBias: false },
  { name: "strong-move", displacementAtr: 1.5 },
  { name: "deep-entry", entryDepth: 1.0 },
  { name: "london-ny", hours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16] },
  { name: "wide-stop", minStopPct: 0.4 },
];

function load(symbol) {
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith(`${symbol}-5m-`) && f.endsWith(".csv")).sort();
  const rows = [];
  for (const f of files) {
    for (const line of readFileSync(join(DATA_DIR, f), "utf8").split("\n")) {
      const p = line.split(",");
      const t = Number(p[0]);
      if (!Number.isFinite(t) || p.length < 6) continue; // header
      rows.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
}

const symbols = [...new Set(readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv")).map((f) => f.split("-")[0]))].sort();
const data = Object.fromEntries(symbols.map((s) => [s, load(s)]));
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "∞");
const lines = [];
const out = (s) => { console.log(s); lines.push(s); };

out(`# Khasroy Trading — backtest`);
for (const s of symbols) {
  const c = data[s];
  out(`- ${s}: ${c.length} candles, ${new Date(c[0].t).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1].t).toISOString().slice(0, 10)}`);
}
out("");
out(`| variant | RR | pair | trades | win% | avg R | total R | PF | max DD (R) | lose streak | $200 → | DD % | /day |`);
out(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
const best = [];
for (const v of VARIANTS) {
  // tf: group 5m candles into larger ones (3 = 15m) before applying the rules.
  const tf = v.tf ?? 1;
  const params = { ...DEFAULT_PARAMS, barMinutes: 5 * tf, ...v };
  for (const rr of v.rrs ?? [3, 5]) {
    const all = [];
    let days = 0;
    for (const s of symbols) {
      const c = tf > 1 ? aggregate(data[s], tf) : data[s];
      const setups = findSetups(c, params);
      const trades = simulate(c, setups, rr, params);
      const d = (c[c.length - 1].t - c[0].t) / 86_400_000;
      days = Math.max(days, d);
      const st = stats(trades, 200, 1, d);
      out(`| ${v.name} | 1:${rr} | ${s} | ${st.trades} | ${fmt(st.winRate * 100, 1)} | ${fmt(st.avgR, 3)} | ${fmt(st.totalR, 1)} | ${fmt(st.profitFactor)} | ${fmt(st.maxDrawdownR, 1)} | ${st.longestLosing} | ${fmt(st.balance, 0)} | ${fmt(st.maxDrawdownPct, 1)} | ${fmt(st.perDay, 2)} |`);
      all.push(...trades.map((t) => ({ ...t, sym: s })));
    }
    all.sort((a, b) => a.setup.time - b.setup.time);
    const st = stats(all, 200, 1, days);
    out(`| **${v.name}** | **1:${rr}** | **all** | **${st.trades}** | **${fmt(st.winRate * 100, 1)}** | **${fmt(st.avgR, 3)}** | **${fmt(st.totalR, 1)}** | **${fmt(st.profitFactor)}** | **${fmt(st.maxDrawdownR, 1)}** | **${st.longestLosing}** | **${fmt(st.balance, 0)}** | **${fmt(st.maxDrawdownPct, 1)}** | **${fmt(st.perDay, 2)}** |`);
    best.push({ name: `${v.name} 1:${rr}`, st, all });
  }
}

// Month by month for the best variant: is the edge steady or one lucky month?
best.sort((a, b) => b.st.totalR - a.st.totalR);
const top = best[0];
out("");
out(`## By month — ${top.name}`);
out(`| month | trades | win% | total R |`);
out(`|---|---|---|---|`);
const months = new Map();
for (const t of top.all.filter((t) => t.outcome === "win" || t.outcome === "loss")) {
  const m = new Date(t.setup.time).toISOString().slice(0, 7);
  const x = months.get(m) ?? { n: 0, w: 0, r: 0 };
  x.n++; if (t.outcome === "win") x.w++; x.r += t.r;
  months.set(m, x);
}
for (const [m, x] of [...months].sort()) out(`| ${m} | ${x.n} | ${fmt((x.w / x.n) * 100, 0)} | ${fmt(x.r, 1)} |`);

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
// Out of sample: the rules were tuned looking at the whole period, so the last third is the
// honest check — a variant that only wins in the first two thirds is fitted to the past.
const t0 = Math.min(...symbols.map((s) => data[s][0].t));
const t1 = Math.max(...symbols.map((s) => data[s][data[s].length - 1].t));
const split = t0 + ((t1 - t0) * 2) / 3;
out("");
out(`## Out of sample (last third, from ${new Date(split).toISOString().slice(0, 10)})`);
out(`| variant | first 2/3: trades / win% / total R | last 1/3: trades / win% / total R |`);
out(`|---|---|---|`);
for (const b of best) {
  const days = (t1 - t0) / 86_400_000;
  const a = stats(b.all.filter((t) => t.setup.time < split), 200, 1, (days * 2) / 3);
  const z = stats(b.all.filter((t) => t.setup.time >= split), 200, 1, days / 3);
  b.oos = z;
  out(`| ${b.name} | ${a.trades} / ${fmt(a.winRate * 100, 1)} / ${fmt(a.totalR, 1)} | ${z.trades} / ${fmt(z.winRate * 100, 1)} / ${fmt(z.totalR, 1)} |`);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.slice(-best.length - 4).join("\n") + "\n");

// Annotations stay readable through the API even when logs are not.
for (const b of best) {
  const s = b.st;
  console.log(`::notice title=${b.name}::trades ${s.trades} | win ${fmt(s.winRate * 100, 1)}% | avgR ${fmt(s.avgR, 3)} | totalR ${fmt(s.totalR, 1)} | PF ${fmt(s.profitFactor)} | DD ${fmt(s.maxDrawdownR, 1)}R/${fmt(s.maxDrawdownPct, 1)}% | streak ${s.longestLosing} | $200→${fmt(s.balance, 0)} | ${fmt(s.perDay, 2)}/day | last third: ${b.oos.trades} tr, win ${fmt(b.oos.winRate * 100, 1)}%, ${fmt(b.oos.totalR, 1)}R`);
}
const monthsText = [...months].sort().map(([m, x]) => `${m}:${x.n}/${fmt((x.w / x.n) * 100, 0)}%/${fmt(x.r, 1)}R`).join(" ");
console.log(`::notice title=by month ${top.name}::${monthsText}`);
