import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/brain/resource-router.ts", import.meta.url), "utf8");

assert.match(source, /function runtimeScore\(/, "resource router must calculate a runtime health score");
assert.match(source, /successes\s*\/\s*total/, "runtime score must account for observed reliability");
assert.match(source, /consecutiveFailures/, "runtime score must penalize repeated failures");
assert.match(source, /averageLatencyMs/, "runtime score must account for observed latency");
assert.match(source, /if \(a\.available !== b\.available\) return a\.available \? -1 : 1;/, "available resources must rank ahead of unavailable resources");
assert.match(source, /runtimeScore\(b, snapshot\) - runtimeScore\(a, snapshot\)/, "resource ordering must use the health-aware score");

console.log("resource router health-aware ranking contract: ok");
