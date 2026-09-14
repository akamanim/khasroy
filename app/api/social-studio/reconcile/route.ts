import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEFAULT_RECONCILE_STALE_MINUTES,
  SOCIAL_CHANNELS,
  adapterEnvName,
  isSocialChannel,
  normalizeAdapterStatusResult,
  type PublishQueueItem,
  type SocialChannel,
} from "@/lib/smm-publisher";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_ENDPOINT =
  process.env.KHASROY_SOCIAL_STORE_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-social-store";

type ReconcileRequest = {
  channel?: unknown;
  maxItems?: unknown;
  staleMinutes?: unknown;
};

type StoreResponse = {
  ok?: boolean;
  items?: PublishQueueItem[];
  item?: PublishQueueItem | null;
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

async function checkAdapterStatus(webhook: string, item: PublishQueueItem) {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-khasroy-idempotency-key": item.id,
      },
      body: JSON.stringify({
        source: "khasroy-social-reconciler-v1",
        action: "status",
        idempotencyKey: item.id,
        item: { id: item.id, channel: item.channel },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json().catch(() => null);
    const normalized = normalizeAdapterStatusResult(data);
    if (!response.ok && normalized.state !== "published") {
      return {
        state: "unknown" as const,
        error: normalized.state === "unknown" ? normalized.error : `adapter_status_http_${response.status}`,
        retryable: normalized.state === "unknown" ? normalized.retryable : true,
      };
    }
    return normalized;
  } catch (error) {
    return {
      state: "unknown" as const,
      error: error instanceof Error ? error.message.slice(0, 1000) : "adapter_status_network_failure",
      retryable: true,
    };
  }
}

function configuredAdapters(requested?: SocialChannel) {
  const channels = requested ? [requested] : SOCIAL_CHANNELS;
  return new Map(channels.flatMap((channel) => {
    const webhook = process.env[adapterEnvName(channel)]?.trim();
    return webhook ? [[channel, webhook] as const] : [];
  }));
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

  const body = (await request.json().catch(() => null)) as ReconcileRequest | null;
  if (body?.channel != null && !isSocialChannel(body.channel)) {
    return NextResponse.json({ error: "invalid_channel", supported: SOCIAL_CHANNELS }, { status: 400 });
  }
  const requestedChannel = isSocialChannel(body?.channel) ? body.channel : undefined;
  const maxItems = typeof body?.maxItems === "number" && Number.isFinite(body.maxItems)
    ? Math.min(20, Math.max(1, Math.trunc(body.maxItems)))
    : 5;
  const staleMinutes = typeof body?.staleMinutes === "number" && Number.isFinite(body.staleMinutes)
    ? Math.min(1440, Math.max(5, Math.trunc(body.staleMinutes)))
    : DEFAULT_RECONCILE_STALE_MINUTES;

  const adapters = configuredAdapters(requestedChannel);
  if (adapters.size === 0) {
    return NextResponse.json({
      ok: false,
      error: "no_publish_adapter_configured",
      requestedChannel: requestedChannel || null,
      adapterEnvNames: (requestedChannel ? [requestedChannel] : SOCIAL_CHANNELS).map(adapterEnvName),
    }, { status: 503 });
  }

  let stale: StoreResponse;
  try {
    stale = await storeAction(apiKey, ownerKey, {
      action: "list_stale_publishing",
      channel: requestedChannel,
      staleMinutes,
      limit: maxItems,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "social_store_failure",
      stage: "list_stale",
    }, { status: 503 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const item of stale.items || []) {
    const webhook = adapters.get(item.channel);
    if (!webhook) {
      results.push({ id: item.id, channel: item.channel, ok: false, status: "untouched", error: "adapter_not_configured" });
      continue;
    }

    const status = await checkAdapterStatus(webhook, item);
    if (status.state === "published") {
      try {
        const marked = await storeAction(apiKey, ownerKey, {
          action: "mark_published",
          id: item.id,
          publishedId: status.publishedId,
        });
        results.push({ id: item.id, channel: item.channel, ok: true, status: marked.item?.status || "published", publishedId: status.publishedId });
      } catch (error) {
        results.push({ id: item.id, channel: item.channel, ok: false, status: "publishing", stage: "commit_reconciled_success", error: error instanceof Error ? error.message : "social_store_failure" });
      }
      continue;
    }

    if (status.state === "not_found") {
      try {
        const marked = await storeAction(apiKey, ownerKey, {
          action: "mark_failed",
          id: item.id,
          error: "adapter_confirmed_not_found_after_stale_claim",
          retryable: true,
        });
        results.push({
          id: item.id,
          channel: item.channel,
          ok: true,
          status: marked.item?.status || (marked.terminal ? "failed" : "ready"),
          reconciledAs: "not_found",
          terminal: marked.terminal === true,
          retryAfterSeconds: marked.retryAfterSeconds ?? null,
        });
      } catch (error) {
        results.push({ id: item.id, channel: item.channel, ok: false, status: "publishing", stage: "commit_not_found", error: error instanceof Error ? error.message : "social_store_failure" });
      }
      continue;
    }

    // Unknown status is deliberately non-destructive. A stale item remains in
    // publishing until the adapter can prove either success or absence.
    results.push({
      id: item.id,
      channel: item.channel,
      ok: false,
      status: "publishing",
      reconciledAs: "unknown",
      error: status.error,
      retryable: status.retryable,
    });
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok === true || result.status === "publishing" || result.status === "untouched"),
    service: "khasroy-social-reconciler",
    version: 1,
    staleMinutes,
    checked: results.length,
    configuredChannels: Array.from(adapters.keys()),
    results,
  });
}
