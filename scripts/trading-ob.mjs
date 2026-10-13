// Order blocks, tested mechanically. Definition (the common SMC one):
//   1. Break of structure: a candle closes above the highest high of the previous L candles (bullish)
//      after an impulse of at least K × ATR from the start of the move.
//   2. Order block: the last opposite (bearish) candle before that impulse. Zone = its high..low.
//   3. Entry: a limit order at the top of the zone, waiting up to W candles for price to come back.
//      Cancelled if price reaches the target first or closes below the zone.
//   4. Stop under the zone (−0.2 ATR), target R:R 1:rr. Optional trend filter: EMA200 side.
// Mirror image for shorts. Fees: maker on limit entry and target, taker + slippage on the stop,
// funding. Ranked on 2022–2024 only; 2025–2026 looked at once; 2026 shown in dollars.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { aggregate, atr } from "../lib/trading/smc.ts";
import { ema } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const SPLIT = Date.parse("2025-01-01T00:00:00Z");
const Y2026 = Date.parse("2026-01-01T00:00:00Z");
const FEE = { maker: 0.0002, taker: 0.0005, slip: 0.0002, funding8h: 0.0001 };

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
const h1 = Object.fromEntries(symbols.map((s) => [s, load(s)]));
const frames = { "1h": { bars: h1, hours: 1 }, "4h": { bars: Object.fromEntries(symbols.map((s) => [s, aggregate(h1[s], 4, 3_600_000)])), hours: 4 } };

function simulate(c, hours, { L, K, W, rr, trend }) {
  const a = atr(c);
  const e200 = ema(c.map((x) => x.c), 200);
  const trades = [];
  let busyUntil = 0;
  for (let i = Math.max(L, 210); i < c.length - 1; i++) {
    if (i < busyUntil) continue;
    let hi = -Infinity, lo = Infinity;
    for (let k = i - L; k < i; k++) { hi = Math.max(hi, c[k].h); lo = Math.min(lo, c[k].l); }
    const bull = c[i].c > hi && (!trend || c[i].c > e200[i]);
    const bear = c[i].c < lo && (!trend || c[i].c < e200[i]);
    if (!bull && !bear) continue;
    // Last opposite candle within the 10 bars before the break.
    let ob = -1;
    for (let k = i - 1; k >= i - 10; k--) if (bull ? c[k].c < c[k].o : c[k].c > c[k].o) { ob = k; break; }
    if (ob < 0) continue;
    const move = bull ? c[i].c - c[ob].l : c[ob].h - c[i].c;
    if (move < K * a[i]) continue;
    const entry = bull ? c[ob].h : c[ob].l;
    const stop = bull ? c[ob].l - 0.2 * a[i] : c[ob].h + 0.2 * a[i];
    const R = Math.abs(entry - stop);
    if (!(R > 0)) continue;
    const tp = bull ? entry + rr * R : entry - rr * R;
    // Wait for the limit fill.
    let fill = -1;
    for (let k = i + 1; k < Math.min(c.length, i + 1 + W); k++) {
      if (bull ? c[k].h >= tp : c[k].l <= tp) break;              // ran away first
      if (bull ? c[k].l <= entry : c[k].h >= entry) { fill = k; break; }
    }
    if (fill < 0) continue;
    let exitAt = -1, exitPrice = NaN, win = false;
    for (let k = fill; k < c.length; k++) {
      if (bull ? c[k].l <= stop : c[k].h >= stop) { exitAt = k; exitPrice = bull ? Math.min(stop, c[k].o) : Math.max(stop, c[k].o); break; }
      if (k > fill && (bull ? c[k].h >= tp : c[k].l <= tp)) { exitAt = k; exitPrice = tp; win = true; break; }
    }
    if (exitAt < 0) break;
    const gross = bull ? exitPrice - entry : entry - exitPrice;
    const h = (exitAt - fill + 1) * hours;
    const fees = entry * FEE.maker + exitPrice * (win ? FEE.maker : FEE.taker + FEE.slip) + entry * FEE.funding8h * (h / 8);
    trades.push({ time: c[fill].t, r: (gross - fees) / R });
    busyUntil = exitAt + 1;
  }
  return trades;
}

const sum = (ts) => ts.reduce((n, t) => n + t.r, 0);
const st = (ts) => ({ n: ts.length, win: ts.length ? ts.filter((t) => t.r > 0).length / ts.length : 0, total: sum(ts), avg: ts.length ? sum(ts) / ts.length : 0 });
function grow(ts, risk, start = 200) { let v = start, p = start, dd = 0; for (const t of ts) { v = Math.max(0, v + v * risk / 100 * t.r); p = Math.max(p, v); dd = Math.max(dd, 1 - v / p); } return { v, dd }; }

const results = [];
for (const tf of ["1h", "4h"]) for (const L of [20, 50]) for (const K of [1.5, 2.5]) for (const W of [12, 48]) for (const rr of [2, 3, 5]) for (const trend of [false, true]) {
  const all = [];
  for (const s of symbols) if (frames[tf].bars[s].length > 400) all.push(...simulate(frames[tf].bars[s], frames[tf].hours, { L, K, W, rr, trend }));
  all.sort((a, b) => a.time - b.time);
  results.push({ name: `${tf} OB L${L} K${K} W${W} 1:${rr}${trend ? " ema200" : ""}`, train: st(all.filter((t) => t.time < SPLIT)), test: st(all.filter((t) => t.time >= SPLIT)), y26: all.filter((t) => t.time >= Y2026), all });
}
const f = (n, d = 2) => n.toFixed(d);
const line = (r) => `${r.name} | TRAIN ${r.train.n}tr win${f(r.train.win * 100, 0)}% ${f(r.train.avg, 3)}R/tr ${f(r.train.total, 0)}R | HOLDOUT ${r.test.n}tr win${f(r.test.win * 100, 0)}% ${f(r.test.avg, 3)}R/tr ${f(r.test.total, 0)}R | 2026 $200@2%→${f(grow(r.y26, 2).v, 0)} dd${f(grow(r.y26, 2).dd * 100, 0)}%`;
const ranked = [...results].filter((r) => r.train.n >= 80).sort((a, b) => b.train.avg - a.train.avg);
const note = (t, ls) => console.log(`::notice title=${t}::${ls.join(" %0A")}`);
note("setup", [`pairs ${symbols.join(" ")}`, `variants ${results.length}`, `positive on train: ${results.filter((r) => r.train.total > 0).length}, positive on holdout: ${results.filter((r) => r.test.total > 0).length}, positive on both: ${results.filter((r) => r.train.total > 0 && r.test.total > 0).length}`]);
note("top 10 by training (honest pick)", ranked.slice(0, 10).map(line));
note("worst 3 / median", [...ranked.slice(-3).map(line), `median train avg ${f(ranked[Math.floor(ranked.length / 2)].train.avg, 3)}R/tr`]);
note("reference: best on holdout (cherry-picked)", [...results].filter((r) => r.test.n >= 40).sort((a, b) => b.test.avg - a.test.avg).slice(0, 5).map(line));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, ranked.map(line).join("\n\n") + "\n");
