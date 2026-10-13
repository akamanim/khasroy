// The user's setup, mechanically:
//   1. Strong move away from an order block: a candle closes beyond the highest high / lowest low of
//      the last L candles, and the move from the order block is at least K × ATR.
//   2. Order block = the last opposite candle before the move. The move left a fair value gap
//      (candles j-2 and j do not overlap).
//   3. Price comes back into that gap: limit entry at the gap's near edge (or its middle),
//      in the direction of the move. Stop beyond the order block (+0.1 ATR). Target 1:rr.
//   4. The order waits up to W candles; cancelled if price runs to the target first or breaks the stop.
// Fees: maker on the limit entry and target, taker + slippage on the stop. Ranked on the first part
// of the data, then checked once on 2026; 2026 shown as a $200 account at 2% risk.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { aggregate, atr } from "../lib/trading/smc.ts";
import { ema } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const INTERVAL = process.env.INTERVAL || "1m";
const SPLIT = Date.parse(process.env.SPLIT || "2026-01-01T00:00:00Z");
const FEE = { maker: 0.0002, taker: 0.0005, slip: 0.0002 };

function load(symbol) {
  const t = [], o = [], h = [], l = [], c = [], v = [];
  const files = readdirSync(DATA_DIR).filter((f) => f.startsWith(`${symbol}-${INTERVAL}-`) && f.endsWith(".csv")).sort();
  let last = -1;
  for (const f of files) {
    for (const line of readFileSync(join(DATA_DIR, f), "utf8").split("\n")) {
      const p = line.split(",");
      const ts = Number(p[0]);
      if (!Number.isFinite(ts) || p.length < 6 || ts <= last) continue;
      last = ts;
      t.push(ts); o.push(+p[1]); h.push(+p[2]); l.push(+p[3]); c.push(+p[4]); v.push(+p[5]);
    }
  }
  return t.map((ts, i) => ({ t: ts, o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] }));
}
const minutes = { "1m": 1, "5m": 5, "15m": 15 };
const base = minutes[INTERVAL] ?? 1;

/** Highest high / lowest low of the previous L bars, O(n) with monotonic deques. */
function channel(c, L) {
  const hi = new Float64Array(c.length).fill(NaN), lo = new Float64Array(c.length).fill(NaN);
  const dh = [], dl = [];
  for (let i = 0; i < c.length; i++) {
    if (i >= L) { hi[i] = c[dh[0]].h; lo[i] = c[dl[0]].l; }
    while (dh.length && c[dh[dh.length - 1]].h <= c[i].h) dh.pop();
    dh.push(i);
    if (dh[0] <= i - L) dh.shift();
    while (dl.length && c[dl[dl.length - 1]].l >= c[i].l) dl.pop();
    dl.push(i);
    if (dl[0] <= i - L) dl.shift();
  }
  return { hi, lo };
}

function simulate(c, pre, { L, K, rr, mid, trend, W }) {
  const { a, e200 } = pre;
  const { hi, lo } = pre.ch[L];
  const out = [];
  let busy = 0;
  for (let i = 210; i < c.length - 1; i++) {
    if (i < busy) continue;
    const bull = c[i].c > hi[i] && (!trend || c[i].c > e200[i]);
    const bear = c[i].c < lo[i] && (!trend || c[i].c < e200[i]);
    if (!bull && !bear) continue;
    let ob = -1;
    for (let k = i - 1; k >= i - 10; k--) if (bull ? c[k].c < c[k].o : c[k].c > c[k].o) { ob = k; break; }
    if (ob < 0) continue;
    if ((bull ? c[i].c - c[ob].l : c[ob].h - c[i].c) < K * a[i]) continue;
    // First fair value gap of the move.
    let gapNear = NaN, gapFar = NaN;
    for (let j = ob + 2; j <= i; j++) {
      if (bull && c[j - 2].h < c[j].l) { gapNear = c[j].l; gapFar = c[j - 2].h; break; }
      if (!bull && c[j - 2].l > c[j].h) { gapNear = c[j].h; gapFar = c[j - 2].l; break; }
    }
    if (!Number.isFinite(gapNear)) continue;
    const entry = mid ? (gapNear + gapFar) / 2 : gapNear;
    const stop = bull ? c[ob].l - 0.1 * a[i] : c[ob].h + 0.1 * a[i];
    const R = Math.abs(entry - stop);
    if (!(R > 0) || (bull ? stop >= entry : stop <= entry)) continue;
    const tp = bull ? entry + rr * R : entry - rr * R;
    let fill = -1;
    for (let k = i + 1; k < Math.min(c.length, i + 1 + W); k++) {
      if (bull ? c[k].h >= tp : c[k].l <= tp) break;
      if (bull ? c[k].l <= stop : c[k].h >= stop) break;
      if (bull ? c[k].l <= entry : c[k].h >= entry) { fill = k; break; }
    }
    if (fill < 0) { busy = i + 1; continue; }
    let exitAt = -1, exitPrice = NaN, win = false;
    for (let k = fill; k < c.length; k++) {
      if (bull ? c[k].l <= stop : c[k].h >= stop) { exitAt = k; exitPrice = k === fill ? stop : bull ? Math.min(stop, c[k].o) : Math.max(stop, c[k].o); break; }
      if (k > fill && (bull ? c[k].h >= tp : c[k].l <= tp)) { exitAt = k; exitPrice = tp; win = true; break; }
    }
    if (exitAt < 0) break;
    const gross = bull ? exitPrice - entry : entry - exitPrice;
    const fees = entry * FEE.maker + exitPrice * (win ? FEE.maker : FEE.taker + FEE.slip);
    out.push({ time: c[fill].t, r: (gross - fees) / R, stopPct: (R / entry) * 100, feeR: fees / R });
    busy = exitAt + 1;
  }
  return out;
}

const symbols = [...new Set(readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv")).map((f) => f.split("-")[0]))].sort();
const series = {};
for (const s of symbols) {
  const raw = load(s);
  series[s] = { [INTERVAL]: raw };
  if (base === 1) { series[s]["5m"] = aggregate(raw, 5, 60_000); series[s]["15m"] = aggregate(raw, 15, 60_000); }
}
const tfs = Object.keys(series[symbols[0]]);
const sum = (ts) => ts.reduce((n, t) => n + t.r, 0);
const st = (ts) => ({ n: ts.length, win: ts.length ? ts.filter((t) => t.r > 0).length / ts.length : 0, avg: ts.length ? sum(ts) / ts.length : 0, total: sum(ts) });
function grow(ts, risk) { let v = 200, p = 200, dd = 0; for (const t of ts) { v = Math.max(0, v + v * risk / 100 * t.r); p = Math.max(p, v); dd = Math.max(dd, 1 - v / p); } return { v, dd }; }
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

const results = [];
for (const tf of tfs) {
  const pre = {};
  for (const s of symbols) {
    const c = series[s][tf];
    pre[s] = { a: atr(c), e200: ema(c.map((x) => x.c), 200), ch: { 20: channel(c, 20), 50: channel(c, 50) } };
  }
  for (const L of [20, 50]) for (const K of [2, 3]) for (const mid of [false, true]) for (const rr of [2, 3, 5]) for (const trend of [false, true]) {
    const all = [];
    for (const s of symbols) all.push(...simulate(series[s][tf], pre[s], { L, K, rr, mid, trend, W: 60 }));
    all.sort((a, b) => a.time - b.time);
    const train = all.filter((t) => t.time < SPLIT), test = all.filter((t) => t.time >= SPLIT);
    const days = (Math.max(...symbols.map((s) => series[s][tf].at(-1).t)) - SPLIT) / 864e5;
    results.push({
      name: `${tf} L${L} K${K} ${mid ? "mid-gap" : "gap-edge"} 1:${rr}${trend ? " ema200" : ""}`,
      train: st(train), test: st(test), g: grow(test, 2), perDay: test.length / days,
      stopPct: all.length ? all.reduce((n, t) => n + t.stopPct, 0) / all.length : NaN,
      feeR: all.length ? all.reduce((n, t) => n + t.feeR, 0) / all.length : NaN,
    });
  }
}
const line = (r) => `${r.name} | TRAIN ${r.train.n}tr win${f(r.train.win * 100, 0)}% ${f(r.train.avg, 3)}R/tr | 2026 ${r.test.n}tr (${f(r.perDay, 1)}/day) win${f(r.test.win * 100, 0)}% ${f(r.test.avg, 3)}R/tr ${f(r.test.total, 0)}R | $200@2%→${f(r.g.v, 0)} dd${f(r.g.dd * 100, 0)}% | stop ~${f(r.stopPct, 2)}%, fees ${f(r.feeR * 100, 0)}% of risk`;
const note = (t, ls) => console.log(`::notice title=${t}::${ls.join(" %0A")}`);
note("setup", [`interval ${INTERVAL}, pairs ${symbols.join(" ")}, candles ${symbols.map((s) => series[s][INTERVAL].length).join("/")}`, `first ${new Date(series[symbols[0]][INTERVAL][0].t).toISOString().slice(0, 10)}, split ${new Date(SPLIT).toISOString().slice(0, 10)}`, `variants ${results.length}; positive on train ${results.filter((r) => r.train.total > 0).length}; positive in 2026 ${results.filter((r) => r.test.total > 0).length}; both ${results.filter((r) => r.train.total > 0 && r.test.total > 0).length}`]);
for (const tf of tfs) {
  const rs = results.filter((r) => r.name.startsWith(tf + " ")).sort((a, b) => b.train.avg - a.train.avg);
  note(`${tf}: top 5 by training + median`, [...rs.slice(0, 5).map(line), `median: ${line(rs[Math.floor(rs.length / 2)])}`]);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, [...results].sort((a, b) => b.train.avg - a.train.avg).map(line).join("\n\n") + "\n");
