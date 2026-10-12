import assert from "node:assert/strict";
import { AllModelsLimitedError, RateLimitError, nextUtcMidnight, parseDuration, retryAtFrom, waitLabel } from "../lib/ai/limits.ts";

assert.equal(parseDuration("2m59.56s"), 179_560);
assert.equal(parseDuration("7.66s"), 7_660);
assert.equal(parseDuration("1h2m"), 3_720_000);
assert.equal(parseDuration("450ms"), 450);
assert.equal(parseDuration("12"), 12_000);
assert.equal(parseDuration(""), null);
assert.equal(parseDuration("soon"), null);

const now = Date.UTC(2026, 9, 12, 5, 0, 0);
const h = (entries) => new Headers(entries);
assert.equal(retryAtFrom(h({ "retry-after": "20" }), "", "groq", now), now + 21_500);
assert.equal(retryAtFrom(h({ "x-ratelimit-reset-requests": "2m0s", "x-ratelimit-reset-tokens": "7s" }), "", "groq", now), now + 121_500);
assert.equal(retryAtFrom(h({}), "", "groq", now), now + 60_000);
assert.equal(retryAtFrom(h({}), "you have used up your daily free allocation of 10,000 neurons", "cloudflare", now), Date.UTC(2026, 9, 13) + 60_000);
assert.equal(nextUtcMidnight(now), Date.UTC(2026, 9, 13));

assert.equal(waitLabel(45_000), "45 с");
assert.equal(waitLabel(155_000), "2 мин 35 с");
assert.equal(waitLabel(3_900_000), "1 ч 5 мин");

const e = new RateLimitError("groq", now + 5000, "limit");
assert.ok(e instanceof Error && e.retryAt === now + 5000);
assert.ok(new AllModelsLimitedError(now, "x") instanceof Error);
console.log("limits: ok");
