import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SOCIAL_CHANNELS,
  adapterEnvName,
  isRetryableAdapterHttpStatus,
  isSocialChannel,
  normalizeAdapterResult,
  type PublishAttemptResult,
  type PublishQueueItem,
  type SocialChannel,
} from "@/lib/smm-publisher";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_ENDPOINT =
  process.env.KHASROY_SOCIAL_STORE_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-social-store";

type PublishRequest = {
  channel?: unknown;
  maxItems?: unknown;
};

type StoreResponse = {
  ok?: boolean;
  item?: PublishQueueItem | null;
  attempt?: number;
  error?: string;
  terminal?: boolean;
  retryAfterSeconds?: number | null;
};

async function storeAction(apiKey: string, ownerKey: string, payload: Record<string, unknown>) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({ ownerKey, ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => null)) as StoreResponse | null;
  if (!response.ok) throw new Error(data?.error || `social_store_${response.status}`);
  return data || {};
}

async function callAdapter(webhook: string, item: PublishQueueItem, attempt: number): Promise<PublishAttemptResult> {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-khasroy-idempotency-key": item.id,
      },
      body: JSON.stringify({
        source: "khasroy-social-publisher-v1",
        idempotencyKey: item.id,
        attempt,
        item: {
          id: item.id,
          channel: item.channel,
          contentType: item.content_type || null,
          title: item.title || null,
          caption: item.caption || null,
          script: item.script || null,
          mediaUrl: item.media_url || null,
          metadata: item.metadata || {},
          scheduledAt: item.scheduled_at || null,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const data = await response.json().catch(() => null);
    const normalized = normalizeAdapterResult(data);
    if (normalized.ok) return normalized;
    if (response.ok) return normalized;

    return {
      ok: false,
      error: normalized.error === "adapter_publish_failed"
        ? `adapter_http_${response.status}`
        : normalized.error,
      retryable: normalized.retryable && isRetryableAdapterHttpStatus(response.status),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 1000) : "adapter_network_failure",
      retryable: true,
    };
  }
}

function configuredChannels(requested?: SocialChannel) {
  const candidates = requested ? [requested] : SOCIAL_CHANNELS;
  return candidates.flatMap((channel) => {
    const webhook = process.env[adapterEnvName(channel)]?.trim();
    return webhook ? [{ channel, webhook }] : [];
  });
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "social_store_not_configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as PublishRequest | null;
  if (body?.channel != null && !isSocialChannel(body.channel)) {
    return NextResponse.json({ error: "invalid_channel", supported: SOCIAL_CHANNELS }, { status: 400 });
  }
  const requestedChannel = isSocialChannel(body?.channel) ? body.channel : undefined;
  const maxItems = typeof body?.maxItems === "number" && Number.isFinite(body.maxItems)
    ? Math.min(5, Math.max(1, Math.trunc(body.maxItems)))
    : 1;

  const adapters = configuredChannels(requestedChannel);
  if (adapters.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "no_publish_adapter_configured",
      requestedChannel: requestedChannel || null,
      adapterEnvNames: (requestedChannel ? [requestedChannel] : SOCIAL_CHANNELS).map(adapterEnvName),
    }, { status: 503 });
  }

  const results: Array<Record<string, unknown>> = [];
  let remaining = maxItems;

  while (remaining > 0) {
    let claimedAny = false;

    for (const adapter of adapters) {
      if (remaining <= 0) break;
      let claim: StoreResponse;
      try {
        claim = await storeAction(apiKey, ownerKey, { action: "claim_ready", channel: adapter.channel });
      } catch (error) {
        results.push({
          channel: adapter.channel,
          ok: false,
          stage: "claim",
          error: error instanceof Error ? error.message : "social_store_failure",
        });
        continue;
      }

      const item = claim.item;
      if (!item) continue;
      claimedAny = true;
      remaining -= 1;
      const attempt = Math.max(1, Number(claim.attempt) || 1);
      const publishResult = await callAdapter(adapter.webhook, item, attempt);

      if (publishResult.ok) {
        try {
          const marked = await storeAction(apiKey, ownerKey, {
            action: "mark_published",
            id: item.id,
            publishedId: publishResult.publishedId,
          });
          results.push({
            channel: adapter.channel,
            id: item.id,
            ok: true,
            status: marked.item?.status || "published",
            publishedId: publishResult.publishedId,
            attempt,
          });
        } catch (error) {
          results.push({
            channel: adapter.channel,
            id: item.id,
            ok: false,
            stage: "commit_success",
            publishedId: publishResult.publishedId,
            attempt,
            error: error instanceof Error ? error.message : "social_store_failure",
          });
        }
        continue;
      }

      try {
        const marked = await storeAction(apiKey, ownerKey, {
          action: "mark_failed",
          id: item.id,
          error: publishResult.error,
          retryable: publishResult.retryable,
        });
        results.push({
          channel: adapter.channel,
          id: item.id,
          ok: false,
          status: marked.item?.status || (marked.terminal ? "failed" : "ready"),
          attempt,
          error: publishResult.error,
          retryable: publishResult.retryable,
          terminal: marked.terminal === true,
          retryAfterSeconds: marked.retryAfterSeconds ?? null,
        });
      } catch (error) {
        results.push({
          channel: adapter.channel,
          id: item.id,
          ok: false,
          stage: "commit_failure",
          attempt,
          error: error instanceof Error ? error.message : "social_store_failure",
        });
      }
    }

    if (!claimedAny) break;
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok !== false || result.status === "ready"),
    service: "khasroy-social-publisher",
    version: 1,
    configuredChannels: adapters.map((adapter) => adapter.channel),
    processed: results.length,
    results,
  });
}
