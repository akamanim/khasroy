import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildSmmPlan } from "@/lib/smm-pipeline";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import type { WebStudioSpec } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanRequest = {
  spec?: unknown;
  cadenceDays?: unknown;
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

  return NextResponse.json({
    ok: true,
    service: "khasroy-social-studio-plan",
    deterministic: true,
    externalProviderUsed: false,
    plan,
  });
}
