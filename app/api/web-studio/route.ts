import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
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

export async function GET() {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    ok: true,
    service: "khasroy-web-studio",
    runtime: webStudioRuntimeStatus(),
    projects: await listWebProjects(auth.ownerKey, 20).catch(() => []),
  });
}

export async function POST(request: Request) {
  const auth = await ownerContext();
  if ("error" in auth) return auth.error;
  const apiKey = process.env.GROQ_API_KEY?.trim() || "";

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
    const result = await buildWebsite({ ownerKey: auth.ownerKey, apiKey, brief, publish: body?.publish !== false });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Khasroy Web Studio failed", error);
    const message = error instanceof Error ? error.message : "web_studio_failed";
    return NextResponse.json(
      {
        ok: false,
        error: "Web Studio не завершил операцию.",
        detail: message.slice(0, 600),
        runtime: webStudioRuntimeStatus(),
      },
      { status: 502 },
    );
  }
}
