import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { composeWithRepairLoop } from "@/lib/smm-compose";
import type { SmmContentItem } from "@/lib/smm-pipeline";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ComposeRequest = {
  item?: unknown;
  maxRepairAttempts?: unknown;
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
  return NextResponse.json({
    ok: result.quality.passed,
    service: "khasroy-social-studio-compose",
    deterministic: true,
    externalProviderUsed: false,
    ...result,
  }, { status: result.quality.passed ? 200 : 422 });
}
