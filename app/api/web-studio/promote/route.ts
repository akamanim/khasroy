import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { auditDraftSpec } from "@/lib/web-studio-quality";
import { getWebProject } from "@/lib/web-studio-editor";
import { promoteStoredWebProject } from "@/lib/web-studio-promotion";
import type { WebStudioSpec } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DRAFT_ENDPOINT = process.env.KHASROY_WEB_DRAFT_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-draft";

type DraftEvidence = {
  provider: string;
  deployUrl: string;
  httpVerified: boolean;
  databaseLeads: boolean;
  isolatedDraftToken: boolean;
};

async function ownerContext() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return { error: NextResponse.json({ error: "owner_not_configured" }, { status: 503 }) } as const;
  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { ownerKey } as const;
}

async function verifyFreshDraft(ownerKey: string, projectSlug: string): Promise<DraftEvidence> {
  const response = await fetch(DRAFT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "issue", ownerKey, projectSlug }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as {
    draftUrl?: unknown;
    provider?: unknown;
    httpVerified?: unknown;
    databaseLeads?: unknown;
    isolatedDraftToken?: unknown;
    error?: unknown;
  } | null;
  const deployUrl = typeof data?.draftUrl === "string" ? data.draftUrl : "";
  if (!response.ok || !deployUrl) {
    const detail = typeof data?.error === "string" ? data.error : `http_${response.status}`;
    throw new Error(`draft_verification_${detail}`);
  }
  return {
    provider: typeof data?.provider === "string" ? data.provider : "supabase_edge",
    deployUrl,
    httpVerified: data?.httpVerified === true,
    databaseLeads: data?.databaseLeads !== false,
    isolatedDraftToken: data?.isolatedDraftToken === true,
  };
}

export async function POST(request: Request) {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as { projectSlug?: unknown } | null;
  const projectSlug = typeof body?.projectSlug === "string" ? body.projectSlug.trim() : "";
  if (!projectSlug) return NextResponse.json({ error: "project_slug_required" }, { status: 400 });

  try {
    const project = await getWebProject(auth.ownerKey, projectSlug);
    if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });
    if (!project.spec || typeof project.spec !== "object") {
      return NextResponse.json({ error: "web_project_spec_invalid" }, { status: 409 });
    }

    const quality = auditDraftSpec(project.spec as WebStudioSpec);
    const draft = await verifyFreshDraft(auth.ownerKey, project.project_slug);
    if (!draft.httpVerified || !quality.ok) {
      return NextResponse.json({
        ok: false,
        error: "verified_draft_required",
        detail: !draft.httpVerified
          ? "Черновик не прошёл свежую HTTP-проверку; production не изменён."
          : `Черновик не прошёл quality/mobile gate: ${quality.issues.join(", ")}.`,
        target: "draft",
        draft,
        qualityGate: quality,
        productionUntouched: true,
        promotionGate: { required: true, freshHttpRequired: true, qualityRequired: true, passed: false },
      }, { status: 409 });
    }

    const promotion = await promoteStoredWebProject({ ownerKey: auth.ownerKey, project });
    return NextResponse.json({
      ...promotion,
      target: "vercel",
      source: "verified_saved_draft",
      draft,
      qualityGate: quality,
      promotionGate: { required: true, freshHttpRequired: true, qualityRequired: true, passed: true },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "promotion_failed";
    return NextResponse.json({
      ok: false,
      error: "web_studio_promotion_failed",
      detail: detail.slice(0, 600),
      productionState: "unchanged_or_previous_release_retained",
    }, { status: 502 });
  }
}
