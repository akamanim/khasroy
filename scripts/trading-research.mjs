// Strategy research on Binance USDⓈ-M futures 1h candles (data.binance.vision).
// Protocol against fooling ourselves: every variant is ranked ONLY on the training years;
// the holdout years are looked at once, for the variants that won on training.
import { readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { stats, aggregate } from "../lib/trading/smc.ts";
import { donchian, emaCross, rsiRevert, squeeze, run, momentumPortfolio } from "../lib/trading/research.ts";

const DATA_DIR = process.env.DATA_DIR || "data";
const SPLIT = Date.parse(process.env.SPLIT || "2025-01-01T00:00:00Z");
const MIN_TRADES = Number(process.env.MIN_TRADES || 80);

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

const strategies = [];
for (const tf of ["1h", "4h", "1d"]) {
  for (const n of tf === "1d" ? [20, 55] : [20, 55, 100]) {
    for (const stop of [1.5, 2.5]) {
      for (const exit of [{ kind: "target", rr: 3 }, { kind: "target", rr: 5 }, { kind: "trail", atrMult: 3 }]) {
        for (const ma of [0, 200]) strategies.push({ tf, s: donchian(n, stop, exit, ma) });
      }
    }
  }
  for (const [f, sl] of [[20, 50], [50, 200]]) {
    for (const exit of [{ kind: "rule" }, { kind: "trail", atrMult: 3 }, { kind: "target", rr: 3 }]) strategies.push({ tf, s: emaCross(f, sl, 2, exit) });
  }
  for (const low of [5, 10]) for (const stop of [1.5, 3]) strategies.push({ tf, s: rsiRevert(low, stop, { kind: "rule", maxBars: 20 }) });
  for (const n of [50, 120]) for (const exit of [{ kind: "target", rr: 3 }, { kind: "trail", atrMult: 3 }]) strategies.push({ tf, s: squeeze(n, 2, exit) });
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "∞");
const results = [];
for (const { tf, s } of strategies) {
  const { bars, hours } = frames[tf];
  const all = [];
  for (const sym of symbols) {
    const c = bars[sym];
    if (c.length < 300) continue;
    const { signals, closeRule } = s.build(c);
    for (const t of run(c, signals, s.exit, hours, undefined, closeRule)) all.push({ ...t, outcome: t.r > 0 ? "win" : "loss", setup: { time: t.time }, sym });
  }
  all.sort((a, b) => a.time - b.time);
  const t0 = Math.min(...symbols.map((x) => h1[x][0].t));
  const t1 = Math.max(...symbols.map((x) => h1[x][h1[x].length - 1].t));
  const train = stats(all.filter((t) => t.time < SPLIT), 200, 1, (SPLIT - t0) / 864e5);
  const test = stats(all.filter((t) => t.time >= SPLIT), 200, 1, (t1 - SPLIT) / 864e5);
  results.push({ name: `${tf} ${s.name}`, train, test, all });
}

// Rank on training only.
const ranked = results.filter((r) => r.train.trades >= MIN_TRADES).sort((a, b) => b.train.avgR - a.train.avgR);
const line = (r) =>
  `${r.name} | TRAIN ${r.train.trades}tr win${fmt(r.train.winRate * 100, 0)}% ${fmt(r.train.avgR, 3)}R/tr ${fmt(r.train.totalR, 0)}R PF${fmt(r.train.profitFactor)} DD${fmt(r.train.maxDrawdownPct, 0)}% | HOLDOUT ${r.test.trades}tr win${fmt(r.test.winRate * 100, 0)}% ${fmt(r.test.avgR, 3)}R/tr ${fmt(r.test.totalR, 0)}R PF${fmt(r.test.profitFactor)} DD${fmt(r.test.maxDrawdownPct, 0)}% $200→${fmt(r.test.balance, 0)}`;

const md = [`# Strategy research`, `pairs: ${symbols.join(" ")}`, `train < ${new Date(SPLIT).toISOString().slice(0, 10)} ≤ holdout`, `variants: ${results.length}`, "", "## Top 25 by training expectancy", ...ranked.slice(0, 25).map(line)];
console.log(md.join("\n"));

// Family winners: the best training variant of each family, judged on the holdout.
const families = ["donchian", "ema", "rsi2", "squeeze"];
const fam = families.map((f) => ranked.find((r) => r.name.split(" ")[1].startsWith(f))).filter(Boolean);

// Cross-sectional momentum portfolios (daily bars).
const mom = [];
for (const lookback of [7, 14, 30]) {
  for (const reb of [1, 7]) {
    for (const top of [2, 3]) {
      for (const longShortByBtc of [false, true]) {
        const { equity, turnover } = momentumPortfolio(frames["1d"].bars, lookback, reb, top, undefined, longShortByBtc);
        const part = (from, to) => {
          const e = equity.filter((x) => x.t >= from && x.t < to);
          if (e.length < 30) return null;
          const v0 = e[0].v;
          let peak = v0;
          let dd = 0;
          for (const x of e) { peak = Math.max(peak, x.v); dd = Math.max(dd, 1 - x.v / peak); }
          const years = (e[e.length - 1].t - e[0].t) / (365 * 864e5);
          return { ret: e[e.length - 1].v / v0 - 1, cagr: (e[e.length - 1].v / v0) ** (1 / years) - 1, dd };
        };
        mom.push({ name: `mom ${lookback}d reb${reb}d top${top}${longShortByBtc ? " btc-filter" : " long-short"}`, train: part(0, SPLIT), test: part(SPLIT, Infinity), turnover });
      }
    }
  }
}
mom.sort((a, b) => (b.train?.cagr ?? -9) - (a.train?.cagr ?? -9));
const momLine = (m) => `${m.name} | TRAIN cagr ${fmt((m.train?.cagr ?? NaN) * 100, 0)}% dd ${fmt((m.train?.dd ?? NaN) * 100, 0)}% | HOLDOUT ret ${fmt((m.test?.ret ?? NaN) * 100, 0)}% cagr ${fmt((m.test?.cagr ?? NaN) * 100, 0)}% dd ${fmt((m.test?.dd ?? NaN) * 100, 0)}%`;
console.log("\n## Momentum portfolios\n" + mom.map(momLine).join("\n"));

// Holdout month by month for the training winner.
const best = ranked[0];
const months = new Map();
for (const t of best.all.filter((t) => t.time >= SPLIT)) {
  const m = new Date(t.time).toISOString().slice(0, 7);
  const x = months.get(m) ?? { n: 0, r: 0 };
  x.n++; x.r += t.r;
  months.set(m, x);
}
const monthText = [...months].sort().map(([m, x]) => `${m}:${x.n}tr/${fmt(x.r, 1)}R`).join(" ");

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n\n") + "\n\n## Momentum\n\n" + mom.map(momLine).join("\n\n") + "\n");
const note = (title, lines) => console.log(`::notice title=${title}::${lines.join(" %0A")}`);
note("setup", [`pairs ${symbols.join(" ")}`, `candles ${symbols.map((s) => `${s}:${h1[s].length}`).join(" ")}`, `variants ${results.length}, split ${new Date(SPLIT).toISOString().slice(0, 10)}`]);
note("top 1-8 by training", ranked.slice(0, 8).map(line));
note("top 9-16 by training", ranked.slice(8, 16).map(line));
note("best of each family", fam.map(line));
note("momentum top 8 by training", mom.slice(0, 8).map(momLine));
note(`holdout by month: ${best.name}`, [monthText]);
const holdoutBest = [...results].filter((r) => r.test.trades >= 40).sort((a, b) => b.test.avgR - a.test.avgR).slice(0, 5);
note("for reference only (picked on holdout, not valid)", holdoutBest.map(line));
