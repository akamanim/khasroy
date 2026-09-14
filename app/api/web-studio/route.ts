import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { installImageFetchHardening } from "@/lib/ai/image-fetch-hardening";
import { installPersistentProviderGate } from "@/lib/ai/persistent-provider-gate";
import { installProviderFailover } from "@/lib/ai/provider-failover";
import { installVisionFailover } from "@/lib/ai/vision-failover";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { resolveAISecrets } from "@/lib/server-integrations";
import { buildWebsite, webStudioRuntimeStatus } from "@/lib/web-studio";
import {
  editWebsite,
  getWebProject,
  listSiteLeads,
  listWebProjects,
  updateSiteLeadStatus,
} from "@/lib/web-studio-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STORE_ENDPOINT = process.env.KHASROY_WEB_STUDIO_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";
const DRAFT_ENDPOINT = process.env.KHASROY_WEB_DRAFT_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-draft";

// Web Studio must use the same survival stack as Site Agent. This keeps planning
// and edit requests alive when Groq is quota blocked: persistent health can try
// Gateway, and a failed Gateway can fall through to the direct Gemini layer.
installImageFetchHardening();
installVisionFailover();
installProviderFailover();
installPersistentProviderGate();

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

async function issueDraft(ownerKey: string, projectSlug: string) {
  // Draft links deliberately use their own freshly rotated site token. A later
  // production promotion generates another token inside buildWebsite(), which
  // invalidates the old draft link and gives Vercel the new production token.
  const siteToken = randomBytes(30).toString("base64url");
  const tokenResponse = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: STORE_KEY },
    body: JSON.stringify({ action: "set_site_token", ownerKey, projectSlug, siteToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`draft_token_${tokenResponse.status}`);

  const url = new URL(DRAFT_ENDPOINT);
  url.searchParams.set("project", projectSlug);
  url.searchParams.set("token", siteToken);
  const draftUrl = url.toString();
  const verification = await fetch(draftUrl, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!verification.ok) throw new Error(`draft_http_${verification.status}`);

  return {
    provider: "supabase_edge",
    deployUrl: draftUrl,
    httpVerified: true,
    databaseLeads: true,
  };
}

export async function GET() {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    ok: true,
    service: "khasroy-web-studio",
    runtime: { ...webStudioRuntimeStatus(), draftStaging: true, finalTarget: "vercel" },
    projects: await listWebProjects(auth.ownerKey, 20).catch(() => []),
  });
}

export async function POST(request: Request) {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    brief?: unknown;
    publish?: unknown;
    projectSlug?: unknown;
    instruction?: unknown;
    leadId?: unknown;
    status?: unknown;
    limit?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "build";

  try {
    if (action === "list_projects") {
      return NextResponse.json({ ok: true, projects: await listWebProjects(auth.ownerKey, Number(body?.limit) || 50) });
    }

    if (action === "get_project") {
      const projectSlug = typeof body?.projectSlug === "string" ? body.projectSlug.trim() : "";
      if (!projectSlug) return NextResponse.json({ error: "project_slug_required" }, { status: 400 });
      const project = await getWebProject(auth.ownerKey, projectSlug);
      return project ? NextResponse.json({ ok: true, project }) : NextResponse.json({ error: "project_not_found" }, { status: 404 });
    }

    if (action === "list_leads") {
      const projectSlug = typeof body?.projectSlug === "string" ? body.projectSlug.trim() : undefined;
      const leads = await listSiteLeads(auth.ownerKey, projectSlug, Number(body?.limit) || 50);
      return NextResponse.json({ ok: true, leads });
    }

    if (action === "update_lead") {
      const leadId = typeof body?.leadId === "string" ? body.leadId.trim() : "";
      const status = typeof body?.status === "string" ? body.status : "";
      if (!leadId || !["new", "contacted", "qualified", "won", "lost", "spam"].includes(status)) {
        return NextResponse.json({ error: "invalid_lead_update" }, { status: 400 });
      }
      await updateSiteLeadStatus(auth.ownerKey, leadId, status as "new" | "contacted" | "qualified" | "won" | "lost" | "spam");
      return NextResponse.json({ ok: true });
    }

    // Resolve the brain credential from either Vercel env or the encrypted
    // Integration Vault. The old route only accepted GROQ_API_KEY from env,
    // making key rotation and the Vault ineffective for the actual Web Studio.
    const secrets = await resolveAISecrets(auth.ownerKey);
    const apiKey = secrets.groq;

    if (action === "edit") {
      if (!apiKey) return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
      const projectSlug = typeof body?.projectSlug === "string" ? body.projectSlug.trim() : "";
      const instruction = typeof body?.instruction === "string" ? body.instruction.trim().slice(0, 10000) : "";
      if (!projectSlug || !instruction) return NextResponse.json({ error: "project_slug_and_instruction_required" }, { status: 400 });
      return NextResponse.json(await editWebsite({ ownerKey: auth.ownerKey, apiKey, projectSlug, instruction }));
    }

    if (!apiKey) return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
    const brief = typeof body?.brief === "string" ? body.brief.trim().slice(0, 10000) : "";
    if (!brief) return NextResponse.json({ error: "brief_required" }, { status: 400 });

    // Normal Web Studio work now goes to the unlimited draft lane. Vercel is an
    // explicit promotion target only: callers must send publish:true when the
    // draft has passed the repair/verification loop and is ready for the clean
    // production release.
    const promoteToProduction = body?.publish === true;
    const result = await buildWebsite({ ownerKey: auth.ownerKey, apiKey, brief, publish: promoteToProduction });

    if (!promoteToProduction) {
      const draft = await issueDraft(auth.ownerKey, result.spec.slug);
      return NextResponse.json({ ...result, target: "draft", draft });
    }

    return NextResponse.json({ ...result, target: "vercel", draft: null });
  } catch (error) {
    console.error("Khasroy Web Studio failed", error);
    const message = error instanceof Error ? error.message : "web_studio_failed";
    return NextResponse.json(
      {
        ok: false,
        error: "Web Studio не завершил операцию.",
        detail: message.slice(0, 600),
        runtime: { ...webStudioRuntimeStatus(), draftStaging: true, finalTarget: "vercel" },
      },
      { status: 502 },
    );
  }
}
