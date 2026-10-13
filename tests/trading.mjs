import assert from "node:assert/strict";
import { aggregate, atr, positionSize, simulate, stats, swings, findSetups, DEFAULT_PARAMS } from "../lib/trading/smc.ts";

const T = 1_700_000_100_000 - (1_700_000_100_000 % 3_600_000);
const bar = (i, o, h, l, c) => ({ t: T + i * 300_000, o, h, l, c, v: 1 });

// 12 five-minute bars make one hour.
const hour = aggregate(Array.from({ length: 24 }, (_, i) => bar(i, 10 + i, 11 + i, 9 + i, 10.5 + i)), 12);
assert.equal(hour.length, 2);
assert.equal(hour[0].o, 10);
assert.equal(hour[0].h, 22);
assert.equal(hour[1].c, 33.5);

// A fractal swing is known only k bars later.
const zig = [5, 6, 9, 6, 5, 4, 2, 4, 5].map((v, i) => bar(i, v, v + 0.5, v - 0.5, v));
const sw = swings(zig, 2);
assert.deepEqual(sw.highs.map((s) => [s.at, s.seen]), [[2, 4]]);
assert.deepEqual(sw.lows.map((s) => [s.at, s.seen]), [[6, 8]]);
assert.ok(atr(zig).every((x) => x > 0));

// Simulation: a long that fills and reaches 1:3, one that is stopped, one where both happen in one bar.
const setup = (at, entry, sl) => ({ side: "long", at, time: T + at * 300_000, entry, sl, sweep: { at, level: sl, extreme: sl }, choch: { at, level: entry }, gap: { at, low: entry - 1, high: entry }, bias: "long" });
const path = [
  bar(0, 105, 106, 104, 105), bar(1, 105, 105, 99.5, 101), bar(2, 101, 131, 100, 130), // fill at 100, then target 130 (risk 10)
  bar(3, 130, 131, 129, 130), bar(4, 130, 130, 99, 100), bar(5, 100, 100, 89, 90),     // fill at 100, stop 90
  bar(6, 105, 106, 104, 105), bar(7, 105, 131, 89, 100),                              // fill, stop and target in one bar
];
const trades = simulate(path, [setup(0, 100, 90), setup(3, 100, 90), setup(6, 100, 90)], 3, { ...DEFAULT_PARAMS, expiry: 3 });
assert.deepEqual(trades.map((t) => t.outcome), ["win", "loss", "loss"]);
assert.ok(trades[0].r > 2.9 && trades[0].r < 3, `win is 3R minus fees, got ${trades[0].r}`);
assert.ok(trades[1].r < -1 && trades[1].r > -1.1, `loss is 1R plus fees, got ${trades[1].r}`);
const st = stats(trades, 200, 1);
assert.equal(st.wins, 1);
assert.equal(st.longestLosing, 2);
assert.ok(Math.abs(st.balance - 200 * (1 + 0.01 * trades[0].r) * (1 + 0.01 * trades[1].r) * (1 + 0.01 * trades[2].r)) < 1e-9);

// Position: $200, 1% risk, stop 0.5% away → $2 risk, $400 notional, 2x leverage.
const pos = positionSize(200, 1, 100, 99.5);
assert.ok(Math.abs(pos.riskUsd - 2) < 1e-9 && Math.abs(pos.notional - 400) < 1e-6 && Math.abs(pos.leverageNeeded - 2) < 1e-9);

// The scanner never looks ahead: setups found on a prefix are the same as on the full series.
let p = 100;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const series = Array.from({ length: 6000 }, (_, i) => {
  const o = p;
  const c = (p = p * (1 + rnd() * 0.006));
  return bar(i, o, Math.max(o, c) * (1 + Math.abs(rnd()) * 0.002), Math.min(o, c) * (1 - Math.abs(rnd()) * 0.002), c);
});
const full = findSetups(series, { ...DEFAULT_PARAMS, useBias: false });
const prefix = findSetups(series.slice(0, 4000), { ...DEFAULT_PARAMS, useBias: false });
assert.ok(full.length > 5, "random data still gives some setups");
assert.deepEqual(prefix.map((s) => s.time), full.filter((s) => s.at < 4000 - DEFAULT_PARAMS.swingK).map((s) => s.time).slice(0, prefix.length));
for (const s of full) assert.ok(s.side === "long" ? s.sl < s.entry : s.sl > s.entry);
console.log("trading: ok");

// The live rule in the edge function gives the same signals as the researched one.
{
  const { breakout } = await import("../supabase/functions/khasroy-trading/rule.ts");
  const { donchian } = await import("../lib/trading/research.ts");
  const research = donchian(100, 1.5, { kind: "target", rr: 3 }).build(series).signals;
  const live = [];
  for (let i = 0; i < series.length; i++) {
    const s = breakout(series, i);
    if (s) live.push({ at: i, side: s.side, risk: s.risk });
  }
  assert.deepEqual(live, research);
  assert.ok(live.length > 20);
  console.log("trading live rule: ok");
}

// Site: analysis, paper wallet, history.
{
  const { analyze, paperWallet, historyTrades, equityPath } = await import("../lib/trading/analysis.ts");
  const c4 = series.slice(0, 400);
  const a = analyze(c4, c4[c4.length - 1].c, 0.0001);
  assert.ok(a && a.breakoutHigh > a.breakoutLow && a.points.length >= 5 && a.verdict.length > 20);
  assert.ok(!/ATR|EMA/.test(a.verdict + a.points.map((p) => p.text).join(" ")), "plain words: no ATR/EMA jargon");
  const hi = Math.max(...c4.slice(-100).map((x) => x.h));
  assert.equal(a.breakoutHigh, hi);
  assert.ok(Math.abs(a.plan.long.tp - a.plan.long.entry - 3 * (a.plan.long.entry - a.plan.long.sl)) < 1e-9);

  const sig = (id, status, r, created, closed, side = "long") => ({ id, symbol: "BTCUSDT", side, entry: 100, sl: 90, tp: 130, status, r, created_at: created, closed_at: closed });
  const w = paperWallet([
    sig("a", "win", 2.9, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
    sig("b", "loss", -1.1, "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z"),
    sig("c", "open", null, "2026-10-05T00:00:00Z", null),
  ], 200, 1, { BTCUSDT: 105 });
  const after1 = 200 + 2 * 2.9;           // risk $2 on $200
  const after2 = after1 - after1 * 0.01 * 1.1;
  assert.ok(Math.abs(w.balance - after2) < 1e-9);
  assert.ok(Math.abs(w.unrealized - 0.5 * after2 * 0.01) < 1e-9, "open trade marked at +0.5R");
  assert.equal(w.closed, 2);
  assert.equal(w.wins, 1);

  const h = historyTrades({ BTCUSDT: series });
  const { donchian, run } = await import("../lib/trading/research.ts");
  const rule = donchian(100, 1.5, { kind: "target", rr: 3 });
  assert.equal(h.length, run(series, rule.build(series).signals, rule.exit, 4).length);
  const e = equityPath(h, 200, 0.5);
  // Chart trades: the same entries as the simulator, plus the still-open one; stories in plain words.
  const { chartTrades, tradeStory } = await import("../lib/trading/analysis.ts");
  const ct = chartTrades(series);
  const closedCt = ct.filter((t) => t.status !== "open");
  assert.deepEqual(closedCt.map((t) => t.entryT), h.map((t) => t.time));
  assert.deepEqual(closedCt.map((t) => t.status), h.map((t) => (t.r > 0 ? "win" : "loss")));
  for (const t of ct) {
    assert.ok(t.side === "long" ? t.sl < t.entry && t.entry < t.tp : t.tp < t.entry && t.entry < t.sl);
    const st = tradeStory(series, t, series[series.length - 1].c, series[series.length - 1].t);
    assert.ok(st.why.length > 40 && st.expect.length > 40 && st.result.length > 10 && !/ATR|EMA/.test(st.why + st.expect));
  }
  assert.equal(a.callouts.length, 3);
  assert.ok(a.callouts.every((x) => c4.some((k) => k.t === x.t)));
  assert.equal(e.trades, h.length);
  console.log("trading site: ok");
}
