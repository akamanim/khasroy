import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { listSiteLeads } from "@/lib/web-studio-editor";
import { triageLeads } from "@/lib/web-studio-lead-triage";
import { planLeadFollowups } from "@/lib/web-studio-lead-followup";
import { buildFollowupQueue, persistFollowupQueue } from "@/lib/web-studio-followup-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerKeyOrResponse() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return { response: NextResponse.json({ error: "owner_not_configured" }, { status: 503 }) } as const;
  const session = (await cookies()).get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { ownerKey } as const;
}

function requestScope(request: Request) {
  const url = new URL(request.url);
  const projectSlug = url.searchParams.get("projectSlug")?.trim() || undefined;
  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 100;
  return { projectSlug, limit };
}

async function planQueue(ownerKey: string, request: Request) {
  const { projectSlug, limit } = requestScope(request);
  const leads = await listSiteLeads(ownerKey, projectSlug, limit);
  const triage = triageLeads(leads);
  const followup = planLeadFollowups(triage.leads, limit);
  const followupQueue = buildFollowupQueue(followup.plans, limit);
  return { projectSlug, triage, followup, followupQueue };
}

export async function GET(request: Request) {
  const auth = await ownerKeyOrResponse();
  if ("response" in auth) return auth.response;
  try {
    const { projectSlug, triage, followup, followupQueue } = await planQueue(auth.ownerKey, request);
    return NextResponse.json({ ok: true, mode: "deterministic_lead_triage_v4", projectSlug: projectSlug || null, ...triage, followup, followupQueue, autonomousSafe: true, mutationsPerformed: false });
  } catch (error) {
    console.error("Khasroy Web Studio lead triage failed", error);
    return NextResponse.json({ error: "lead_triage_unavailable" }, { status: 503 });
  }
}

/** Persist deterministic actions for later approval. This never contacts a lead and never
 * changes CRM status; it only creates idempotent awaiting_approval rows in Supabase. */
export async function POST(request: Request) {
  const auth = await ownerKeyOrResponse();
  if ("response" in auth) return auth.response;
  try {
    const { projectSlug, followupQueue } = await planQueue(auth.ownerKey, request);
    const persistence = await persistFollowupQueue(auth.ownerKey, followupQueue.items);
    return NextResponse.json({
      ok: true,
      mode: "followup_queue_persist_v1",
      projectSlug: projectSlug || null,
      persistence,
      requiresHumanApproval: true,
      autonomousExecutionAllowed: false,
      leadMessagesSent: 0,
      crmMutationsPerformed: 0,
    });
  } catch (error) {
    console.error("Khasroy Web Studio follow-up persistence failed", error);
    return NextResponse.json({ error: "followup_queue_persist_unavailable" }, { status: 503 });
  }
}
