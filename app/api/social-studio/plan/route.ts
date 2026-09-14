import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildSmmPlan } from "@/lib/smm-pipeline";
import type { SmmContentItem } from "@/lib/smm-pipeline";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import type { WebStudioSpec } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_ENDPOINT =
  process.env.KHASROY_WEB_STUDIO_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";

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

async function queueInstagramPlanItem(ownerKey: string, apiKey: string, item: SmmContentItem) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      ownerKey,
      action: "queue_social",
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
    error?: string;
  } = {
    requested: persist,
    ok: true,
    saved: 0,
    skipped: 0,
    ids: [],
  };

  if (persist) {
    const apiKey = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY?.trim();
    const instagramItems = plan.items.filter((item) => item.channel === "instagram");
    const skipped = plan.items.length - instagramItems.length;

    if (!apiKey) {
      persistence = {
        requested: true,
        ok: false,
        saved: 0,
        skipped: plan.items.length,
        ids: [],
        error: "social_store_not_configured",
      };
    } else {
      const results = await Promise.allSettled(
        instagramItems.map((item) => queueInstagramPlanItem(ownerKey, apiKey, item)),
      );
      const ids = results
        .filter((result): result is PromiseFulfilledResult<string | null> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((id): id is string => Boolean(id));
      const failures = results.filter((result) => result.status === "rejected").length;

      persistence = {
        requested: true,
        ok: failures === 0,
        saved: ids.length,
        skipped: skipped + failures,
        ids,
        ...(failures ? { error: "partial_social_store_failure" } : {}),
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
