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

function failureMessage(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  const reason = result.reason;
  return reason instanceof Error ? reason.message.slice(0, 240) : String(reason || "unknown_error").slice(0, 240);
}

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
    const [skillsResult, brainResult, pendingTasksResult] = await Promise.allSettled([
      getSkills(ownerKey),
      selfHostedHealth(),
      getPendingTasks(ownerKey, 100),
    ]);

    const skills = skillsResult.status === "fulfilled" && Array.isArray(skillsResult.value)
      ? skillsResult.value
      : [];
    const brain = brainResult.status === "fulfilled"
      ? brainResult.value
      : { configured: false, online: false, model: null as string | null };
    const pendingTasks = pendingTasksResult.status === "fulfilled" && Array.isArray(pendingTasksResult.value)
      ? pendingTasksResult.value
      : [];

    const verified = skills.filter((skill) => skill.status === "verified");
    const has = (slug: string) => verified.some((skill) => skill.slug === slug);
    const learningHas = (slug: string) =>
      skills.some((skill) => skill.slug === slug && skill.status === "learning");

    const repository = has("github_self_repository_reader");
    const sandbox = has("cloud_code_sandbox");
    const critic = has("independent_response_critic");
    const scheduledAutonomy = has("autonomous_learning_loop");
    const autoSkill = has("on_demand_skill_acquisition");
    const autoSkillLearning = learningHas("on_demand_skill_acquisition");
    const autonomy = scheduledAutonomy || autoSkill;
    const screenshotVision = has("screenshot_vision");
    const visualComparison = has("visual_before_after_comparison");
    const visualScoring = has("visual_site_scoring");
    const designAgent = has("site_design_agent");
    const repairLoop = has("site_repair_loop");
    const commercialAudit = has("commercial_site_audit");
    const imageLab = has("chat_image_generation") || has("image_generation_lab");
    const imageLabLearning = learningHas("chat_image_generation");
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
      : autoSkillLearning
        ? "READY"
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
    const diagnostics = {
      skills: {
        ok: skillsResult.status === "fulfilled",
        error: failureMessage(skillsResult),
      },
      selfHosted: {
        ok: brainResult.status === "fulfilled",
        error: failureMessage(brainResult),
      },
      pendingTasks: {
        ok: pendingTasksResult.status === "fulfilled",
        error: failureMessage(pendingTasksResult),
      },
    };
    const degraded = Object.values(diagnostics).some((item) => !item.ok);

    return NextResponse.json({
      status: degraded ? "degraded" : "ok",
      diagnostics,
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
        imageLab: imageLab ? "VERIFIED" : imageLabLearning ? "READY" : "WAITING",
        autoSkill: autoSkill ? "VERIFIED" : autoSkillLearning ? "READY" : "WAITING",
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
      learningSkills: skills
        .filter((skill) => skill.status === "learning")
        .map((skill) => ({
          slug: skill.slug,
          name: skill.name,
          level: skill.level,
          testsPassed: skill.tests_passed,
          testsFailed: skill.tests_failed,
        })),
    });
  } catch (error) {
    console.error("Khasroy status read failed", error);
    return NextResponse.json(
      {
        error: "status_unavailable",
        detail: error instanceof Error ? error.message.slice(0, 240) : "unknown_error",
      },
      { status: 502 },
    );
  }
}
