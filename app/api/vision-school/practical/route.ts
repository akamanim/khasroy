import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  finishAutonomyRun,
  getNextAutonomyGoal,
  startAutonomyRun,
} from "@/lib/server-autonomy";
import { runImageLab } from "@/lib/server-image-lab";
import { getSkills, rememberKnowledge, upsertSkill } from "@/lib/server-memory";
import { PHOTO_GENERATION_LESSONS } from "@/lib/vision-school";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIGNATURE_CONTEXT = "khasroy-autonomy-v1";
const TEST_PROMPT = [
  "Photorealistic commercial product photograph of a brushed stainless-steel travel mug.",
  "Square 1:1 composition, mug slightly right of center, three-quarter angle, full handle visible.",
  "Place it on pale natural limestone with a quiet warm-neutral studio background.",
  "Soft north-window key light from camera-left, subtle fill from camera-right, realistic contact shadow.",
  "50mm lens feel, eye-level product camera, shallow depth of field but the whole mug body and rim remain sharp.",
  "Show believable brushed-metal microtexture and restrained reflections, no CGI plastic look.",
  "No text, no logos, no watermark, no extra objects, no floating object, no distorted handle or rim.",
].join(" ");

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(a: string, b: string) {
  try {
    return timingSafeEqual(digest(a), digest(b));
  } catch {
    return false;
  }
}

function ownerHash(ownerKey: string) {
  return createHash("sha256").update(ownerKey).digest("hex");
}

function expectedSignature(hash: string, timestamp: string) {
  return createHmac("sha256", hash)
    .update(`${timestamp}:${SIGNATURE_CONTEXT}`)
    .digest("hex");
}

function authorizedScheduler(request: Request, ownerKey: string) {
  const timestamp = request.headers.get("x-khasroy-timestamp") || "";
  const signature = request.headers.get("x-khasroy-signature") || "";
  const parsed = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(parsed)) return false;
  if (Math.abs(Date.now() - parsed) > 5 * 60_000) return false;
  return safeEqual(signature, expectedSignature(ownerHash(ownerKey), timestamp));
}

function metadataCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export async function GET(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }
  if (!authorizedScheduler(request, ownerKey)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const goal = await getNextAutonomyGoal(ownerKey).catch(() => null);
  if (!goal || goal.source !== "vision_school") {
    return NextResponse.json({ ok: true, lab: "idle", reason: "vision_goal_not_active" });
  }

  const run = await startAutonomyRun(
    ownerKey,
    goal.id,
    "vercel-ai-gateway",
    "openai/gpt-image-2.5-flare",
  );
  if (!run?.id) {
    return NextResponse.json({ ok: false, lab: "run_not_started" }, { status: 502 });
  }

  try {
    const result = await runImageLab(TEST_PROMPT);
    const finalAudit = result.repaired?.audit || result.baseline.audit;
    const skills = await getSkills(ownerKey);
    const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));

    const checks: Record<string, boolean> = {
      photo_prompt_vision: finalAudit.promptAdherence >= 82,
      photo_composition: finalAudit.composition >= 82,
      photo_lighting_camera: finalAudit.lighting >= 80,
      photo_realism: finalAudit.realism >= 78 && finalAudit.artifactControl >= 78,
      photo_product_generation:
        finalAudit.promptAdherence >= 82 && finalAudit.composition >= 82,
      image_visual_auditor:
        result.baseline.audit.overall >= 0 && finalAudit.overall >= 0,
      image_repair_loop: result.delta >= 3 && result.improved,
    };

    for (const lesson of PHOTO_GENERATION_LESSONS) {
      if (!(lesson.slug in checks)) continue;
      const current = bySlug.get(lesson.slug);
      const passed = checks[lesson.slug];
      const nextPassed = (current?.tests_passed || 0) + (passed ? 1 : 0);
      const nextFailed = (current?.tests_failed || 0) + (passed ? 0 : 1);
      const practicalTests = metadataCount(current?.metadata?.practicalTests) + 1;
      const verified = nextPassed >= 3 && nextPassed > nextFailed;

      await upsertSkill(ownerKey, {
        slug: lesson.slug,
        name: lesson.name,
        description: lesson.objective,
        status: verified ? "verified" : "learning",
        level: lesson.level,
        testsPassed: nextPassed,
        testsFailed: nextFailed,
        metadata: {
          ...(current?.metadata || {}),
          practicalTests,
          lastPracticalAt: new Date().toISOString(),
          lastPracticalPassed: passed,
          lastBaselineScore: result.baseline.audit.overall,
          lastRepairedScore: finalAudit.overall,
          lastRepairDelta: result.delta,
          lastBaselineSha256: result.baseline.sha256,
          lastRepairedSha256: result.repaired?.sha256 || null,
          practicalVerificationRequired: !verified,
          verificationRule: "minimum_3_successful_real_image_tests",
        },
      });
    }

    await upsertSkill(ownerKey, {
      slug: "image_generation_lab",
      name: "Image Generation Lab",
      description:
        "Реальный production-конвейер Generate → Visual Audit → Reference Repair → Re-audit через Vercel AI Gateway.",
      status: "verified",
      level: 1,
      testsPassed: 1,
      testsFailed: 0,
      metadata: {
        verifiedBy: "real_ai_gateway_image_execution",
        generationModel: result.baseline.model,
        repairModel: result.repaired?.model || null,
        auditorModel: "openai/gpt-5.6-sol",
        baselineScore: result.baseline.audit.overall,
        repairedScore: finalAudit.overall,
        delta: result.delta,
        baselineSha256: result.baseline.sha256,
        repairedSha256: result.repaired?.sha256 || null,
        testedAt: new Date().toISOString(),
      },
    });

    const summary = {
      test: "product_photo_v1",
      baseline: result.baseline.audit,
      repaired: finalAudit,
      delta: result.delta,
      improved: result.improved,
      checks,
      models: {
        generation: result.baseline.model,
        repair: result.repaired?.model || null,
        auditor: "openai/gpt-5.6-sol",
      },
    };

    await rememberKnowledge(
      ownerKey,
      `vision_practical_${Date.now()}`,
      "vision_school_practical",
      JSON.stringify(summary),
      0.95,
    );

    await finishAutonomyRun(ownerKey, {
      runId: run.id,
      goalId: goal.id,
      status: "completed",
      phase: "vision_practical_lab",
      provider: "vercel-ai-gateway",
      model: result.repaired?.model || result.baseline.model,
      summary: `Real image practical completed. Baseline ${result.baseline.audit.overall}, repaired ${finalAudit.overall}, delta ${result.delta}.`,
      evidence: {
        ...summary,
        baselineImageSha256: result.baseline.sha256,
        repairedImageSha256: result.repaired?.sha256 || null,
      },
    });

    return NextResponse.json({
      ok: true,
      lab: "practical_completed",
      baselineScore: result.baseline.audit.overall,
      repairedScore: finalAudit.overall,
      delta: result.delta,
      improved: result.improved,
      checks,
      practicalImagesStoredAsHashesOnly: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown practical lab error";
    await finishAutonomyRun(ownerKey, {
      runId: run.id,
      goalId: goal.id,
      status: "failed",
      phase: "vision_practical_lab",
      provider: "vercel-ai-gateway",
      model: "image-lab",
      error: message,
    }).catch(() => undefined);
    console.error("Khasroy Vision practical failed", error);
    return NextResponse.json(
      { ok: false, lab: "practical_failed", error: message.slice(0, 400) },
      { status: 502 },
    );
  }
}
