export type SocialChannel = "instagram" | "tiktok" | "telegram";

export type PublishQueueItem = {
  id: string;
  channel: SocialChannel;
  status: "ready" | "publishing" | "published" | "failed";
  caption?: string | null;
  script?: string | null;
  media_url?: string | null;
  metadata?: Record<string, unknown> | null;
  scheduled_at?: string | null;
};

export type PublishAttemptResult =
  | { ok: true; publishedId: string }
  | { ok: false; error: string; retryable: boolean };

export const MAX_PUBLISH_ATTEMPTS = 5;

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
