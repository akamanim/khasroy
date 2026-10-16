// Ideas collected from small public write-ups (blogs, GitHub, Habr), tested with the same honest
// simulator as trading-research.mjs. Ranked on the training years, holdout shown next to it.
//   capitulation: red daily candle on 2x volume -> long next open, out after one bar (Habr 960670)
//   rsi2-pullback: close > MA50 and RSI(2) < 30 -> long, out when RSI(2) > 80 (Substack "algorithmic crypto")
//   weekday: long for one daily bar, for each day of the week (is there a calendar edge?)
//   btc-regime: capitulation / rsi2 only while BTC is above its own 200-day MA
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { stats, aggregate, atr } from "../lib/trading/smc.ts";
import { run, sma, rsi } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const SPLIT = Date.parse(process.env.SPLIT || "2025-01-01T00:00:00Z");
const load = (symbol) => {
  const rows = [];
  for (const f of readdirSync(DATA_DIR).filter((f) => f.startsWith(`${symbol}-1h-`) && f.endsWith(".csv")).sort())
    for (const line of readFileSync(join(DATA_DIR, f), "utf8").split("\n")) {
      const p = line.split(",");
      const t = Number(p[0]);
      if (Number.isFinite(t) && p.length >= 6) rows.push({ t, o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
    }
  rows.sort((a, b) => a.t - b.t);
  return rows.filter((r, i) => i === 0 || r.t !== rows[i - 1].t);
};
const symbols = [...new Set(readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv")).map((f) => f.split("-")[0]))].sort();
const h1 = Object.fromEntries(symbols.map((s) => [s, load(s)]));
const frames = { "4h": { hours: 4, bars: Object.fromEntries(symbols.map((s) => [s, aggregate(h1[s], 4, 3_600_000)])) }, "1d": { hours: 24, bars: Object.fromEntries(symbols.map((s) => [s, aggregate(h1[s], 24, 3_600_000)])) } };
const btcDaily = frames["1d"].bars["BTCUSDT"] ?? [];
const btcMa = sma(btcDaily.map((x) => x.c), 200);
const btcUpAt = (t) => { let lo = 0, hi = btcDaily.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (btcDaily[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 200 && btcDaily[k].c > btcMa[k]; };

const volAvg = (c, n) => c.map((_, i) => { if (i < n) return NaN; let s = 0; for (let k = i - n; k < i; k++) s += c[k].v; return s / n; });
const strategies = [];
for (const tf of ["1d", "4h"]) {
  const per = tf === "1d" ? 1 : 6;
  for (const mult of [1.5, 2, 3]) for (const stop of [2, 3]) for (const regime of [false, true]) {
    strategies.push({ tf, name: `capitulation vol>=${mult}x stop${stop}atr${regime ? " btc>ma200" : ""}`, exit: { kind: "rule", maxBars: per }, build: (c) => {
      const a = atr(c), va = volAvg(c, 60 * per), sig = [];
      for (let i = 60 * per + 1; i < c.length; i++) if (c[i].c < c[i].o && c[i].v >= mult * va[i] && (!regime || btcUpAt(c[i].t))) sig.push({ at: i, side: "long", risk: stop * a[i] });
      return { signals: sig };
    } });
  }
  for (const low of [10, 30]) for (const stop of [2, 3]) for (const regime of [false, true]) {
    strategies.push({ tf, name: `rsi2<${low} above MA50 exit RSI>80 stop${stop}atr${regime ? " btc>ma200" : ""}`, exit: { kind: "rule", maxBars: 30 * per }, build: (c) => {
      const a = atr(c), cl = c.map((x) => x.c), r = rsi(cl, 2), m = sma(cl, 50), sig = [];
      for (let i = 50; i < c.length; i++) if (cl[i] > m[i] && r[i] < low && (!regime || btcUpAt(c[i].t))) sig.push({ at: i, side: "long", risk: stop * a[i] });
      return { signals: sig, closeRule: (i) => r[i] > 80 };
    } });
  }
}
for (let d = 0; d < 7; d++) for (const side of ["long", "short"]) {
  strategies.push({ tf: "1d", name: `weekday ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]} bar ${side}`, exit: { kind: "rule", maxBars: 1 }, build: (c) => {
    const a = atr(c), sig = [];
    for (let i = 20; i < c.length; i++) if (new Date(c[i].t).getUTCDay() === (d + 6) % 7) sig.push({ at: i, side, risk: 3 * a[i] });
    return { signals: sig };
  } });
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "∞");
const results = [];
for (const s of strategies) {
  const { bars, hours } = frames[s.tf];
  const all = [];
  for (const sym of symbols) {
    const c = bars[sym];
    if (c.length < 300) continue;
    const { signals, closeRule } = s.build(c);
    for (const t of run(c, signals, s.exit, hours, undefined, closeRule)) all.push({ ...t, outcome: t.r > 0 ? "win" : "loss", setup: { time: t.time }, sym });
  }
  all.sort((a, b) => a.time - b.time);
  const t0 = Math.min(...symbols.map((x) => h1[x][0].t)), t1 = Math.max(...symbols.map((x) => h1[x][h1[x].length - 1].t));
  results.push({ name: `${s.tf} ${s.name}`, train: stats(all.filter((t) => t.time < SPLIT), 200, 1, (SPLIT - t0) / 864e5), test: stats(all.filter((t) => t.time >= SPLIT), 200, 1, (t1 - SPLIT) / 864e5) });
}
const line = (r) => `${r.name} | TRAIN ${r.train.trades}tr win${fmt(r.train.winRate * 100, 0)}% ${fmt(r.train.avgR, 3)}R/tr ${fmt(r.train.totalR, 0)}R PF${fmt(r.train.profitFactor)} | HOLDOUT ${r.test.trades}tr win${fmt(r.test.winRate * 100, 0)}% ${fmt(r.test.avgR, 3)}R/tr ${fmt(r.test.totalR, 0)}R PF${fmt(r.test.profitFactor)}`;
const ranked = results.filter((r) => r.train.trades >= 80).sort((a, b) => b.train.avgR - a.train.avgR);
const md = ["# Wild ideas", `pairs: ${symbols.join(" ")}`, `train < ${new Date(SPLIT).toISOString().slice(0, 10)} <= holdout`, "", ...ranked.map(line)];
console.log(md.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n\n") + "\n");
console.log(`::notice title=wild top 1-12 by training::${ranked.slice(0, 12).map(line).join(" %0A")}`);
console.log(`::notice title=wild 13-24::${ranked.slice(12, 24).map(line).join(" %0A")}`);
