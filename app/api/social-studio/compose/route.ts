import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { composeWithRepairLoop } from "@/lib/smm-compose";
import type { SmmContentItem } from "@/lib/smm-pipeline";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_ENDPOINT =
  process.env.KHASROY_SOCIAL_STORE_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-social-store";

type ComposeRequest = {
  item?: unknown;
  maxRepairAttempts?: unknown;
  persist?: unknown;
};

function isSmmContentItem(value: unknown): value is SmmContentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SmmContentItem>;
  return (
    typeof item.id === "string" &&
    typeof item.day === "number" && Number.isFinite(item.day) &&
    (item.channel === "instagram" || item.channel === "tiktok" || item.channel === "telegram") &&
    (item.format === "reel" || item.format === "carousel" || item.format === "story" || item.format === "post") &&
    (item.pillar === "offer" || item.pillar === "education" || item.pillar === "trust" || item.pillar === "proof" || item.pillar === "engagement") &&
    typeof item.hook === "string" &&
    typeof item.angle === "string" &&
    typeof item.cta === "string" &&
    typeof item.source === "string"
  );
}

async function persistComposedArtifact(
  ownerKey: string,
  apiKey: string,
  planItemId: string,
  artifact: ReturnType<typeof composeWithRepairLoop>["artifact"],
  quality: ReturnType<typeof composeWithRepairLoop>["quality"],
) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      ownerKey,
      action: "save_composed",
      planItemId,
      artifact,
      quality,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json().catch(() => null)) as { item?: { id?: string; status?: string }; error?: string } | null;
  if (!response.ok) throw new Error(data?.error || `social_store_${response.status}`);
  return {
    id: data?.item?.id || null,
    status: data?.item?.status || "ready",
  };
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ComposeRequest | null;
  if (!isSmmContentItem(body?.item)) {
    return NextResponse.json({ error: "valid_smm_plan_item_required" }, { status: 400 });
  }

  const maxRepairAttempts = typeof body?.maxRepairAttempts === "number" && Number.isFinite(body.maxRepairAttempts)
    ? Math.min(3, Math.max(0, Math.trunc(body.maxRepairAttempts)))
    : 2;

  const result = composeWithRepairLoop(body.item, maxRepairAttempts);
  const persist = body?.persist === true;
  let persistence: {
    requested: boolean;
    ok: boolean;
    id: string | null;
    status: string | null;
    error?: string;
  } = {
    requested: persist,
    ok: !persist,
    id: null,
    status: null,
  };

  if (persist) {
    if (!result.quality.passed) {
      persistence = {
        requested: true,
        ok: false,
        id: null,
        status: null,
        error: "quality_gate_failed",
      };
    } else {
      const apiKey = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY?.trim();
      if (!apiKey) {
        persistence = {
          requested: true,
          ok: false,
          id: null,
          status: null,
          error: "social_store_not_configured",
        };
      } else {
        try {
          const saved = await persistComposedArtifact(
            ownerKey,
            apiKey,
            body.item.id,
            result.artifact,
            result.quality,
          );
          persistence = {
            requested: true,
            ok: true,
            id: saved.id,
            status: saved.status,
          };
        } catch (error) {
          persistence = {
            requested: true,
            ok: false,
            id: null,
            status: null,
            error: error instanceof Error ? error.message : "social_store_failure",
          };
        }
      }
    }
  }

  return NextResponse.json({
    ok: result.quality.passed,
    service: "khasroy-social-studio-compose",
    deterministic: true,
    externalProviderUsed: false,
    ...result,
    persistence,
  }, { status: result.quality.passed ? 200 : 422 });
}
