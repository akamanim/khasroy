import assert from "node:assert/strict";
import {
  MAX_PUBLISH_ATTEMPTS,
  adapterEnvName,
  nextPublishState,
  normalizeAdapterResult,
  retryDelaySeconds,
} from "../lib/smm-publisher.ts";

assert.equal(retryDelaySeconds(1), 30);
assert.equal(retryDelaySeconds(2), 60);
assert.equal(retryDelaySeconds(20), 3600);
assert.equal(adapterEnvName("telegram"), "KHASROY_SOCIAL_TELEGRAM_WEBHOOK");

const success = nextPublishState(1, { ok: true, publishedId: "post-123" });
assert.deepEqual(success, {
  status: "published",
  publishedId: "post-123",
  retryAfterSeconds: null,
  terminal: true,
  lastError: null,
});

const retry = nextPublishState(2, { ok: false, error: "rate_limited", retryable: true });
assert.equal(retry.status, "ready");
assert.equal(retry.retryAfterSeconds, 60);
assert.equal(retry.terminal, false);

const exhausted = nextPublishState(MAX_PUBLISH_ATTEMPTS, { ok: false, error: "still failing", retryable: true });
assert.equal(exhausted.status, "failed");
assert.equal(exhausted.terminal, true);

const permanent = nextPublishState(1, { ok: false, error: "permission_denied", retryable: false });
assert.equal(permanent.status, "failed");
assert.equal(permanent.retryAfterSeconds, null);

assert.deepEqual(normalizeAdapterResult({ ok: true, publishedId: " abc " }), { ok: true, publishedId: "abc" });
assert.deepEqual(normalizeAdapterResult({ error: "temporary" }), { ok: false, error: "temporary", retryable: true });
assert.deepEqual(normalizeAdapterResult({ error: "bad auth", retryable: false }), { ok: false, error: "bad auth", retryable: false });

console.log("smm-publisher tests passed");
