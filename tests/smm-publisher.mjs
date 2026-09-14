import assert from "node:assert/strict";
import {
  DEFAULT_RECONCILE_STALE_MINUTES,
  MAX_PUBLISH_ATTEMPTS,
  SOCIAL_CHANNELS,
  adapterEnvName,
  isRetryableAdapterHttpStatus,
  isSocialChannel,
  nextPublishState,
  normalizeAdapterResult,
  normalizeAdapterStatusResult,
  retryDelaySeconds,
} from "../lib/smm-publisher.ts";

assert.equal(retryDelaySeconds(1), 30);
assert.equal(retryDelaySeconds(2), 60);
assert.equal(retryDelaySeconds(20), 3600);
assert.equal(adapterEnvName("telegram"), "KHASROY_SOCIAL_TELEGRAM_WEBHOOK");
assert.equal(DEFAULT_RECONCILE_STALE_MINUTES, 15);
assert.deepEqual(SOCIAL_CHANNELS, ["instagram", "tiktok", "telegram"]);
assert.equal(isSocialChannel("instagram"), true);
assert.equal(isSocialChannel("youtube"), false);
assert.equal(isRetryableAdapterHttpStatus(408), true);
assert.equal(isRetryableAdapterHttpStatus(425), true);
assert.equal(isRetryableAdapterHttpStatus(429), true);
assert.equal(isRetryableAdapterHttpStatus(503), true);
assert.equal(isRetryableAdapterHttpStatus(400), false);
assert.equal(isRetryableAdapterHttpStatus(401), false);

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

assert.deepEqual(normalizeAdapterStatusResult({ state: "published", publishedId: " remote-42 " }), {
  state: "published",
  publishedId: "remote-42",
});
assert.deepEqual(normalizeAdapterStatusResult({ state: "not_found" }), { state: "not_found" });
assert.deepEqual(normalizeAdapterStatusResult({ state: "processing" }), {
  state: "unknown",
  error: "adapter_status_unknown",
  retryable: true,
});
assert.deepEqual(normalizeAdapterStatusResult({ state: "published" }), {
  state: "unknown",
  error: "adapter_status_missing_published_id",
  retryable: true,
});
assert.deepEqual(normalizeAdapterStatusResult({ error: "auth_failed", retryable: false }), {
  state: "unknown",
  error: "auth_failed",
  retryable: false,
});

console.log("smm-publisher tests passed");
