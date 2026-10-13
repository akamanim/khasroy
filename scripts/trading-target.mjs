// Target search: is there a strategy that turns $200 into $600+ in 8 months, and does it do it
// reliably — not just in the one 8-month stretch we happen to look at?
// Every variant × risk level is replayed over EVERY 8-month window since 2022 (monthly starts).
// A strategy that triples once and halves twice is luck, not a strategy; the table shows both.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { aggregate } from "../lib/trading/smc.ts";
import { donchian, emaCross, rsiRevert, squeeze, run, momentumPortfolio } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const WINDOW_MONTHS = 8;
const RISKS = [0.5, 1, 2, 3, 5];

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
const frames = {
  "1h": { bars: h1, hours: 1 },
  "4h": { bars: Object.fromEntries(symbols.map((s) => [s, aggregate(h1[s], 4, 3_600_000)])), hours: 4 },
  "1d": { bars: Object.fromEntries(symbols.map((s) => [s, aggregate(h1[s], 24, 3_600_000)])), hours: 24 },
};
const tEnd = Math.max(...symbols.map((s) => h1[s][h1[s].length - 1].t));
const tStart = Math.min(...symbols.map((s) => h1[s][0].t));

// 8-month windows starting on the 1st of each month.
const windows = [];
for (let d = new Date(Date.UTC(new Date(tStart).getUTCFullYear(), new Date(tStart).getUTCMonth() + 1, 1)); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + WINDOW_MONTHS, 1);
  if (end > tEnd + 864e5) break;
  windows.push({ from: d.getTime(), to: end, label: d.toISOString().slice(0, 7) });
}
const last = windows[windows.length - 1];

const strategies = [];
for (const tf of ["1h", "4h", "1d"]) {
  for (const n of tf === "1d" ? [10, 20, 55] : [20, 55, 100]) {
    for (const stop of [1, 1.5, 2.5]) {
      for (const exit of [{ kind: "target", rr: 2 }, { kind: "target", rr: 3 }, { kind: "target", rr: 5 }, { kind: "target", rr: 10 }, { kind: "trail", atrMult: 2 }, { kind: "trail", atrMult: 4 }]) {
        for (const ma of [0, 200]) strategies.push({ tf, s: donchian(n, stop, exit, ma) });
      }
    }
  }
  for (const [f, sl] of [[9, 21], [20, 50], [50, 200]]) {
    for (const exit of [{ kind: "rule" }, { kind: "trail", atrMult: 3 }, { kind: "target", rr: 3 }, { kind: "target", rr: 5 }]) strategies.push({ tf, s: emaCross(f, sl, 2, exit) });
  }
  for (const low of [5, 10]) for (const stop of [1.5, 3]) strategies.push({ tf, s: rsiRevert(low, stop, { kind: "rule", maxBars: 20 }) });
  for (const n of [50, 120]) for (const exit of [{ kind: "target", rr: 3 }, { kind: "target", rr: 5 }, { kind: "trail", atrMult: 3 }]) strategies.push({ tf, s: squeeze(n, 2, exit) });
}

/** $200 compounded through the trades (risk % of the balance each trade), with the max drawdown. */
function grow(trades, risk) {
  let v = 200;
  let peak = 200;
  let dd = 0;
  for (const t of trades) {
    v = Math.max(0, v + v * (risk / 100) * t.r);
    peak = Math.max(peak, v);
    dd = Math.max(dd, 1 - v / peak);
  }
  return { end: v, dd };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const rows = [];
for (const { tf, s } of strategies) {
  const { bars, hours } = frames[tf];
  const all = [];
  for (const sym of symbols) {
    const c = bars[sym];
    if (c.length < 300) continue;
    const { signals, closeRule } = s.build(c);
    for (const t of run(c, signals, s.exit, hours, undefined, closeRule)) all.push(t);
  }
  all.sort((a, b) => a.time - b.time);
  for (const risk of RISKS) {
    const per = windows.map((w) => grow(all.filter((t) => t.time >= w.from && t.time < w.to), risk));
    const ends = per.map((p) => p.end);
    const whole = grow(all, risk);
    rows.push({
      name: `${tf} ${s.name} @${risk}%`,
      last: ends[ends.length - 1],
      lastDd: per[per.length - 1].dd,
      med: median(ends),
      worst: Math.min(...ends),
      hit: ends.filter((e) => e >= 600).length / ends.length,
      bust: ends.filter((e) => e <= 100).length / ends.length,
      dd: whole.dd,
      trades: all.length,
    });
  }
}

// Momentum portfolios with leverage: daily returns × L.
for (const lookback of [7, 14, 30]) {
  for (const top of [2, 3]) {
    for (const filt of [false, true]) {
      const { equity } = momentumPortfolio(frames["1d"].bars, lookback, 7, top, undefined, filt);
      for (const L of [1, 2, 3]) {
        const curve = [{ t: equity[0].t, v: 1 }];
        for (let i = 1; i < equity.length; i++) curve.push({ t: equity[i].t, v: Math.max(0, curve[i - 1].v * (1 + L * (equity[i].v / equity[i - 1].v - 1))) });
        const endIn = (w) => {
          const e = curve.filter((x) => x.t >= w.from && x.t < w.to);
          if (e.length < 30) return null;
          let peak = e[0].v, dd = 0;
          for (const x of e) { peak = Math.max(peak, x.v); dd = Math.max(dd, 1 - x.v / peak); }
          return { end: e[0].v > 0 ? (200 * e[e.length - 1].v) / e[0].v : 0, dd };
        };
        const per = windows.map(endIn).filter(Boolean);
        if (!per.length) continue;
        const ends = per.map((p) => p.end);
        let peak = 1, dd = 0;
        for (const x of curve) { peak = Math.max(peak, x.v); dd = Math.max(dd, 1 - x.v / peak); }
        rows.push({ name: `mom ${lookback}d top${top}${filt ? " btcfilter" : " ls"} x${L}`, last: ends[ends.length - 1], lastDd: per[per.length - 1].dd, med: median(ends), worst: Math.min(...ends), hit: ends.filter((e) => e >= 600).length / ends.length, bust: ends.filter((e) => e <= 100).length / ends.length, dd, trades: 0 });
      }
    }
  }
}

// Buy and hold BTC with leverage, for scale.
{
  const c = frames["1d"].bars.BTCUSDT;
  for (const L of [1, 2, 3]) {
    const ends = windows.map((w) => {
      const e = c.filter((x) => x.t >= w.from && x.t < w.to);
      let v = 200;
      for (let i = 1; i < e.length; i++) v = Math.max(0, v * (1 + L * (e[i].c / e[i - 1].c - 1)));
      return v;
    });
    rows.push({ name: `hold BTC x${L}`, last: ends[ends.length - 1], lastDd: NaN, med: median(ends), worst: Math.min(...ends), hit: ends.filter((e) => e >= 600).length / ends.length, bust: ends.filter((e) => e <= 100).length / ends.length, dd: NaN, trades: 0 });
  }
}

const f0 = (n) => (Number.isFinite(n) ? n.toFixed(0) : "—");
const line = (r) => `${r.name} | last8m $200→${f0(r.last)} (dd${f0(r.lastDd * 100)}%) | median→${f0(r.med)} worst→${f0(r.worst)} | ≥$600 in ${f0(r.hit * 100)}% of windows, ≤$100 in ${f0(r.bust * 100)}% | whole dd${f0(r.dd * 100)}%`;
const note = (title, lines) => console.log(`::notice title=${title}::${lines.join(" %0A")}`);

note("setup", [`pairs ${symbols.join(" ")}`, `${windows.length} windows of ${WINDOW_MONTHS} months, first ${windows[0].label}, last ${last.label}→${new Date(last.to).toISOString().slice(0, 7)}`, `variants×risk ${rows.length}`]);
note("best on the LAST 8 months (picked on it: optimistic)", [...rows].sort((a, b) => b.last - a.last).slice(0, 10).map(line));
note("best MEDIAN 8-month result (robust)", [...rows].sort((a, b) => b.med - a.med).slice(0, 10).map(line));
note("most often reached $600 in 8 months", [...rows].sort((a, b) => b.hit - a.hit || b.med - a.med).slice(0, 10).map(line));
note("best median among never-halved", [...rows].filter((r) => r.bust === 0).sort((a, b) => b.med - a.med).slice(0, 10).map(line));
note("current site rule and benchmarks", rows.filter((r) => r.name.startsWith("4h donchian 100 stop1.5atr tp1:3 @") || r.name.startsWith("hold BTC")).map(line));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["# Target search", ...[...rows].sort((a, b) => b.med - a.med).slice(0, 60).map(line)].join("\n\n") + "\n");
