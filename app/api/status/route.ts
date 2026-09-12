import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { getPendingTasks, getSkills } from "@/lib/server-memory";
import { selfHostedHealth } from "@/lib/brain/providers/self-hosted";
import {
  preferredResource,
  resourceRegistry,
  resourcePlan,
  type ResourceRuntimeOverrides,
} from "@/lib/brain/resource-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [skills, brain, pendingTasks] = await Promise.all([
      getSkills(ownerKey),
      selfHostedHealth(),
      getPendingTasks(ownerKey, 100),
    ]);
    const verified = skills.filter((skill) => skill.status === "verified");
    const has = (slug: string) => verified.some((skill) => skill.slug === slug);

    const repository = has("github_self_repository_reader");
    const sandbox = has("cloud_code_sandbox");
    const critic = has("independent_response_critic");
    const autonomy = has("autonomous_learning_loop");
    const screenshotVision = has("screenshot_vision");
    const visualComparison = has("visual_before_after_comparison");
    const visualScoring = has("visual_site_scoring");
    const designAgent = has("site_design_agent");
    const repairLoop = has("site_repair_loop");
    const commercialAudit = has("commercial_site_audit");
    const imageLab = has("image_generation_lab");
    const siteAgentReady =
      screenshotVision &&
      visualComparison &&
      visualScoring &&
      designAgent &&
      repairLoop &&
      commercialAudit;

    const selfHostedState = brain.online
      ? "ONLINE"
      : brain.configured
        ? "OFFLINE"
        : "WAITING";
    const autonomyState = autonomy
      ? "VERIFIED"
      : brain.online
        ? "READY"
        : "WAITING";

    const overrides: ResourceRuntimeOverrides = {
      "self-hosted": {
        configured: brain.configured,
        available: brain.online,
        reason: brain.online
          ? undefined
          : brain.configured
            ? "offline"
            : "not_configured",
      },
    };
    const resources = resourceRegistry(overrides);
    const preferredText = preferredResource("text", { overrides });

    return NextResponse.json({
      level: Math.max(1, verified.length),
      skills: verified.length,
      testsPassed: verified.reduce(
        (sum, skill) => sum + Math.max(Number(skill.tests_passed) || 0, 0),
        0,
      ),
      capabilities: {
        intelligence: has("live_ai_dialogue") ? 1 : 0,
        security: has("owner_access_control") ? 1 : 0,
        code: (repository ? 1 : 0) + (sandbox ? 1 : 0),
        memory: has("long_term_memory") ? 1 : 0,
        internet: has("internet_research") ? 1 : 0,
        vision:
          (screenshotVision ? 1 : 0) +
          (visualComparison ? 1 : 0) +
          (visualScoring ? 1 : 0),
        voice: 0,
        agents:
          (critic ? 1 : 0) +
          (autonomy ? 1 : 0) +
          (designAgent ? 1 : 0) +
          (repairLoop ? 1 : 0) +
          (commercialAudit ? 1 : 0),
        images: imageLab ? 1 : 0,
      },
      modules: {
        memory: has("long_term_memory") ? "VERIFIED" : "LOCKED",
        github: repository ? "VERIFIED" : "LOCKED",
        internet: has("internet_research") ? "VERIFIED" : "LOCKED",
        sandbox: sandbox ? "VERIFIED" : "LOCKED",
        critic: critic ? "VERIFIED" : "LOCKED",
        vision: screenshotVision ? "VERIFIED" : "WAITING",
        siteAgent: siteAgentReady ? "VERIFIED" : "WAITING",
        imageLab: imageLab ? "VERIFIED" : "WAITING",
        selfHosted: selfHostedState,
        autonomy: autonomyState,
        survival: "ACTIVE",
      },
      brain: {
        preferred: preferredText?.id || "none",
        preferredLabel: preferredText?.label || null,
        selfHostedConfigured: brain.configured,
        selfHostedOnline: brain.online,
        selfHostedModel: brain.model,
      },
      survival: {
        pendingTasks: pendingTasks.length,
        resources,
        plan: resourcePlan(["text", "research", "code", "memory"], {
          overrides,
        }),
      },
      verifiedSkills: verified.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        level: skill.level,
        testsPassed: skill.tests_passed,
      })),
    });
  } catch (error) {
    console.error("Khasroy status read failed", error);
    return NextResponse.json({ error: "status_unavailable" }, { status: 502 });
  }
}
