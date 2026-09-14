import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { resolveSecret } from "@/lib/server-integrations";
import { getWebProject } from "@/lib/web-studio-editor";
import { auditDraftSpec } from "@/lib/web-studio-quality";
import { syncGitHubStagingRepo } from "@/lib/web-studio-github-staging";
import type { WebStudioSpec } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STORE_ENDPOINT = process.env.KHASROY_WEB_STUDIO_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";
const DRAFT_ENDPOINT = process.env.KHASROY_WEB_DRAFT_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-draft";

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

async function verifyDraft(ownerKey: string, projectSlug: string) {
  const response = await fetch(DRAFT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "issue", ownerKey, projectSlug }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as { draftUrl?: unknown; httpVerified?: unknown; error?: unknown } | null;
  if (!response.ok || data?.httpVerified !== true) {
    const detail = typeof data?.error === "string" ? data.error : `http_${response.status}`;
    throw new Error(`draft_not_verified:${detail}`);
  }
  return typeof data.draftUrl === "string" ? data.draftUrl : "";
}

async function saveRepo(ownerKey: string, project: Awaited<ReturnType<typeof getWebProject>>, repo: { repoFullName: string; repoUrl: string }) {
  if (!project) return;
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: STORE_KEY },
    body: JSON.stringify({
      action: "upsert_project",
      ownerKey,
      projectSlug: project.project_slug,
      status: project.status || "building",
      brief: project.brief,
      spec: project.spec,
      repoFullName: repo.repoFullName,
      repoUrl: repo.repoUrl,
      vercelProjectId: project.vercel_project_id,
      deployUrl: project.deploy_url,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`github_export_store_${response.status}`);
}

export async function POST(request: Request) {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null) as { projectSlug?: unknown } | null;
  const projectSlug = typeof body?.projectSlug === "string" ? body.projectSlug.trim() : "";
  if (!projectSlug) return NextResponse.json({ error: "project_slug_required" }, { status: 400 });

  try {
    const project = await getWebProject(auth.ownerKey, projectSlug);
    if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

    const spec = project.spec as WebStudioSpec;
    const quality = auditDraftSpec(spec);
    if (!quality.ok) {
      return NextResponse.json({
        ok: false,
        error: "draft_quality_gate_failed",
        qualityGate: quality,
        productionUntouched: true,
      }, { status: 409 });
    }

    const draftUrl = await verifyDraft(auth.ownerKey, projectSlug);
    const githubToken = await resolveSecret(auth.ownerKey, "github", [process.env.KHASROY_GITHUB_TOKEN, process.env.GITHUB_TOKEN]);
    if (!githubToken) {
      return NextResponse.json({ error: "github_not_configured", productionUntouched: true }, { status: 503 });
    }

    const repo = await syncGitHubStagingRepo({
      token: githubToken,
      spec,
      projectSlug,
      repoFullName: project.repo_full_name || undefined,
    });
    await saveRepo(auth.ownerKey, project, repo);

    return NextResponse.json({
      ok: true,
      projectSlug,
      draftUrl,
      qualityGate: quality,
      ...repo,
      vercelTriggered: false,
      productionUntouched: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "github_staging_export_failed";
    console.error("Khasroy GitHub staging export failed", error);
    const conflict = detail.includes("github_existing_repo_not_khasroy_staging");
    const retryable = /(timeout|429|5\d\d|draft_not_verified)/iu.test(detail);
    return NextResponse.json({
      ok: false,
      error: conflict ? "existing_repo_not_staging" : "github_staging_export_failed",
      detail: detail.slice(0, 500),
      retryable: conflict ? false : retryable,
      productionUntouched: true,
      vercelTriggered: false,
    }, { status: conflict ? 409 : retryable ? 503 : 502 });
  }
}
