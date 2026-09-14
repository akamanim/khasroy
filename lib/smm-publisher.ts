export type SocialChannel = "instagram" | "tiktok" | "telegram";

export const SOCIAL_CHANNELS: SocialChannel[] = ["instagram", "tiktok", "telegram"];

export type PublishQueueItem = {
  id: string;
  channel: SocialChannel;
  content_type?: "reel" | "post" | "story" | "carousel" | null;
  status: "ready" | "publishing" | "published" | "failed";
  title?: string | null;
  caption?: string | null;
  script?: string | null;
  media_url?: string | null;
  metadata?: Record<string, unknown> | null;
  scheduled_at?: string | null;
  updated_at?: string | null;
};

export type PublishAttemptResult =
  | { ok: true; publishedId: string }
  | { ok: false; error: string; retryable: boolean };

export type PublishReconcileResult =
  | { state: "published"; publishedId: string }
  | { state: "not_found" }
  | { state: "unknown"; error: string; retryable: boolean };

export const MAX_PUBLISH_ATTEMPTS = 5;
export const DEFAULT_RECONCILE_STALE_MINUTES = 15;

export function retryDelaySeconds(attempt: number) {
  const n = Math.max(1, Math.trunc(attempt));
  return Math.min(3600, 30 * 2 ** (n - 1));
}

export function nextPublishState(attempt: number, result: PublishAttemptResult) {
  if (result.ok) {
    return {
      status: "published" as const,
      publishedId: result.publishedId,
      retryAfterSeconds: null,
      terminal: true,
      lastError: null,
    };
  }

  const terminal = !result.retryable || attempt >= MAX_PUBLISH_ATTEMPTS;
  return {
    status: terminal ? ("failed" as const) : ("ready" as const),
    publishedId: null,
    retryAfterSeconds: terminal ? null : retryDelaySeconds(attempt),
    terminal,
    lastError: result.error.slice(0, 1000),
  };
}

export function adapterEnvName(channel: SocialChannel) {
  return `KHASROY_SOCIAL_${channel.toUpperCase()}_WEBHOOK`;
}

export function isSocialChannel(value: unknown): value is SocialChannel {
  return typeof value === "string" && SOCIAL_CHANNELS.includes(value as SocialChannel);
}

export function isRetryableAdapterHttpStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function normalizeAdapterResult(value: unknown): PublishAttemptResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "invalid_adapter_response", retryable: true };
  }
  const data = value as Record<string, unknown>;
  if (data.ok === true && typeof data.publishedId === "string" && data.publishedId.trim()) {
    return { ok: true, publishedId: data.publishedId.trim().slice(0, 500) };
  }
  const error = typeof data.error === "string" && data.error.trim()
    ? data.error.trim().slice(0, 1000)
    : "adapter_publish_failed";
  return { ok: false, error, retryable: data.retryable !== false };
}

export function normalizeAdapterStatusResult(value: unknown): PublishReconcileResult {
  if (!value || typeof value !== "object") {
    return { state: "unknown", error: "invalid_adapter_status_response", retryable: true };
  }

  const data = value as Record<string, unknown>;
  const state = typeof data.state === "string" ? data.state.trim().toLowerCase() : "";
  if (state === "published" && typeof data.publishedId === "string" && data.publishedId.trim()) {
    return { state: "published", publishedId: data.publishedId.trim().slice(0, 500) };
  }
  if (state === "not_found") return { state: "not_found" };

  const error = typeof data.error === "string" && data.error.trim()
    ? data.error.trim().slice(0, 1000)
    : state === "published"
      ? "adapter_status_missing_published_id"
      : "adapter_status_unknown";
  return { state: "unknown", error, retryable: data.retryable !== false };
}
