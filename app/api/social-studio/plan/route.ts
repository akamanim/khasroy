import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildSmmPlan } from "@/lib/smm-pipeline";
import type { SmmChannel, SmmContentItem } from "@/lib/smm-pipeline";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import type { WebStudioSpec } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_ENDPOINT =
  process.env.KHASROY_SOCIAL_STORE_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-social-store";

const DEFAULT_STORE_CHANNELS: SmmChannel[] = ["instagram"];

type PlanRequest = {
  spec?: unknown;
  cadenceDays?: unknown;
  persist?: unknown;
};

function isWebStudioSpec(value: unknown): value is WebStudioSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<WebStudioSpec>;
  return (
    typeof spec.brandName === "string" &&
    typeof spec.audience === "string" &&
    typeof spec.primaryCta === "string" &&
    typeof spec.description === "string" &&
    typeof spec.contactText === "string" &&
    Array.isArray(spec.services) && spec.services.every((item) => typeof item === "string") &&
    Array.isArray(spec.advantages) && spec.advantages.every((item) => typeof item === "string")
  );
}

function isSmmChannel(value: unknown): value is SmmChannel {
  return value === "instagram" || value === "tiktok" || value === "telegram";
}

async function getStoreChannels(apiKey: string): Promise<SmmChannel[]> {
  try {
    const response = await fetch(STORE_ENDPOINT, {
      method: "GET",
      headers: { apikey: apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return DEFAULT_STORE_CHANNELS;
    const data = (await response.json().catch(() => null)) as { socialChannels?: unknown } | null;
    const channels = Array.isArray(data?.socialChannels) ? data.socialChannels.filter(isSmmChannel) : [];
    return channels.length ? channels : DEFAULT_STORE_CHANNELS;
  } catch {
    return DEFAULT_STORE_CHANNELS;
  }
}

async function queuePlanItem(ownerKey: string, apiKey: string, item: SmmContentItem) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      ownerKey,
      action: "queue_social",
      channel: item.channel,
      contentType: item.format,
      title: item.hook,
      caption: `${item.hook}\n\n${item.angle}\n\n${item.cta}`,
      script: item.angle,
      metadata: {
        stage: "planned",
        planner: "deterministic_smm_v1",
        planItemId: item.id,
        day: item.day,
        channel: item.channel,
        pillar: item.pillar,
        cta: item.cta,
        source: item.source,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`social_store_${response.status}`);
  const data = (await response.json().catch(() => null)) as { item?: { id?: string } } | null;
  return data?.item?.id || null;
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PlanRequest | null;
  if (!isWebStudioSpec(body?.spec)) {
    return NextResponse.json({ error: "valid_web_studio_spec_required" }, { status: 400 });
  }

  const cadenceDays = typeof body?.cadenceDays === "number" && Number.isFinite(body.cadenceDays)
    ? body.cadenceDays
    : 7;
  const plan = buildSmmPlan(body.spec, cadenceDays);
  const persist = body?.persist === true;

  let persistence: {
    requested: boolean;
    ok: boolean;
    saved: number;
    skipped: number;
    ids: string[];
    channels: Record<string, number>;
    storeChannels: SmmChannel[];
    error?: string;
  } = {
    requested: persist,
    ok: true,
    saved: 0,
    skipped: 0,
    ids: [],
    channels: {},
    storeChannels: [],
  };

  if (persist) {
    const apiKey = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY?.trim();

    if (!apiKey) {
      persistence = {
        requested: true,
        ok: false,
        saved: 0,
        skipped: plan.items.length,
        ids: [],
        channels: {},
        storeChannels: [],
        error: "social_store_not_configured",
      };
    } else {
      const storeChannels = await getStoreChannels(apiKey);
      const persistableItems = plan.items.filter((item) => storeChannels.includes(item.channel));
      const unsupported = plan.items.length - persistableItems.length;
      const results = await Promise.allSettled(
        persistableItems.map(async (item) => ({ item, id: await queuePlanItem(ownerKey, apiKey, item) })),
      );
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<{ item: SmmContentItem; id: string | null }> =>
          result.status === "fulfilled",
      );
      const ids = fulfilled.map((result) => result.value.id).filter((id): id is string => Boolean(id));
      const failures = results.filter((result) => result.status === "rejected").length;
      const channels = fulfilled.reduce<Record<string, number>>((acc, result) => {
        if (result.value.id) acc[result.value.item.channel] = (acc[result.value.item.channel] || 0) + 1;
        return acc;
      }, {});

      persistence = {
        requested: true,
        ok: failures === 0,
        saved: ids.length,
        skipped: unsupported + failures,
        ids,
        channels,
        storeChannels,
        ...(failures
          ? { error: "partial_social_store_failure" }
          : unsupported
            ? { error: "social_store_channel_limited" }
            : {}),
      };
    }
  }

  return NextResponse.json({
    ok: true,
    service: "khasroy-social-studio-plan",
    deterministic: true,
    externalProviderUsed: false,
    plan,
    persistence,
  });
}
