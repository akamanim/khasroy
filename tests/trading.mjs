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
