import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { runImageLab, type ImageAudit } from "@/lib/server-image-lab";
import { recordChatImageGenerationTrial } from "@/lib/server-learning";
import {
  compileImagePrompt,
  loadImageGenerationLessons,
  rememberImageGenerationFailure,
  verifyGeneratedImage,
  type ImageSemanticAudit,
} from "@/lib/server-image-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runEmergencyImage(prompt: string, timeoutMs = 18_000) {
  const seed = Date.now() % 2147483647;
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=1024&height=1024&nologo=true&seed=${seed}`;
  const upstream = await fetch(imageUrl, {
    headers: { "user-agent": "Khasroy-Image-Lab/2.1" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  const mediaType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !mediaType.startsWith("image/")) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`emergency image provider ${upstream.status}: ${text.slice(0, 180)}`);
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const cleanMediaType = mediaType.split(";")[0].trim();
  const base64 = bytes.toString("base64");
  const upstreamModel = upstream.headers.get("x-model-used")?.trim() || "auto";
  return {
    image: `data:${cleanMediaType};base64,${base64}`,
    model: `pollinations-${upstreamModel}`,
    mediaType: cleanMediaType,
  };
}

function semanticFromLabAudit(audit: ImageAudit, model: string): ImageSemanticAudit {
  const overall = Math.max(0, Math.min(100, Math.round(audit.overall)));
  const requestMatch = Math.max(0, Math.min(100, Math.round(audit.promptAdherence)));
  const criticalMismatch = requestMatch < 55;
  const passed = !criticalMismatch && requestMatch >= 72 && overall >= 70;
  return {
    passed,
    score: Number((overall / 100).toFixed(3)),
    subjectMatch: requestMatch,
    sceneMatch: requestMatch,
    requestMatch,
    overall,
    criticalMismatch,
    visibleFacts: audit.strengths.slice(0, 6),
    mismatches: audit.defects.slice(0, 6),
    repairPrompt: audit.repairInstruction,
    model,
  };
}

async function runVerifiedEmergencyImage(args: {
  ownerKey: string;
  apiKey: string;
  prompt: string;
  startedAt: number;
  mode: string;
}) {
  const lessons = await loadImageGenerationLessons(args.ownerKey, 3).catch((error) => {
    console.error("Khasroy image lesson load failed", error);
    return [] as string[];
  });

  let repairPrompt = "";
  let finalImage: Awaited<ReturnType<typeof runEmergencyImage>> | null = null;
  let finalAudit: ImageSemanticAudit | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    try {
      const compiledPrompt = compileImagePrompt(args.prompt, {
        lessons,
        repairPrompt: repairPrompt || undefined,
      });
      const image = await runEmergencyImage(compiledPrompt, 18_000);
      const audit = await verifyGeneratedImage({
        apiKey: args.apiKey,
        prompt: args.prompt,
        imageDataUrl: image.image,
      });

      finalImage = image;
      finalAudit = audit;

      if (audit.passed) break;

      await rememberImageGenerationFailure(args.ownerKey, {
        prompt: args.prompt,
        audit,
      }).catch((error) => console.error("Khasroy image failure lesson save failed", error));

      repairPrompt = audit.repairPrompt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_retry_failure";
      console.error(`Khasroy image attempt ${attempt} failed`, error);

      // If an earlier image was already semantically judged, keep that evidence.
      // A transport failure on the retry must not erase the learning result.
      if (finalImage && finalAudit) {
        finalAudit = {
          ...finalAudit,
          mismatches: [
            ...finalAudit.mismatches,
            `Retry technical failure: ${message.slice(0, 180)}`,
          ].slice(0, 6),
        };
        break;
      }
      throw error;
    }
  }

  if (!finalImage || !finalAudit) throw new Error("image_learning_loop_empty_result");

  const learning = await recordChatImageGenerationTrial(args.ownerKey, {
    prompt: args.prompt,
    model: finalImage.model,
    mediaType: finalImage.mediaType,
    mode: args.mode,
    runtimeMs: Date.now() - args.startedAt,
    attempts,
    audit: finalAudit,
  }).catch((error) => {
    console.error("Khasroy image learning trial failed", error);
    return null;
  });

  return {
    image: finalImage,
    audit: finalAudit,
    learning,
    attempts,
  };
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    fast?: unknown;
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const fast = body?.fast === true;

  if (!prompt) {
    return NextResponse.json({ error: "prompt_required" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY?.trim() || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "visual_verifier_not_configured" },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  if (fast) {
    try {
      const outcome = await runVerifiedEmergencyImage({
        ownerKey,
        apiKey,
        prompt,
        startedAt,
        mode: "fast_semantic_learning",
      });

      if (!outcome.audit.passed) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Финальный результат не прошёл мой визуальный экзамен. Провал и причина сохранены как урок; неподходящую картинку я не показываю.",
            code: "image_semantic_verification_failed",
            audit: outcome.audit,
            attempts: outcome.attempts,
            learning: outcome.learning,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        ok: true,
        lab: "Khasroy Image Generation Lab",
        mode: "fast_semantic_learning",
        image: outcome.image.image,
        model: outcome.image.model,
        baseline: null,
        repaired: outcome.attempts > 1 ? { semanticRetry: true } : null,
        delta: 0,
        improved: outcome.attempts > 1,
        audit: outcome.audit,
        attempts: outcome.attempts,
        learning: outcome.learning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown image learning error";
      console.error("Khasroy semantic image generation failed", error);
      return NextResponse.json(
        {
          ok: false,
          error: "image_generation_failed",
          detail: message.slice(0, 400),
        },
        { status: 502 },
      );
    }
  }

  try {
    const result = await runImageLab(prompt);
    const finalImage = result.improved && result.repaired ? result.repaired : result.baseline;
    const finalLabAudit = result.improved && result.repaired
      ? result.repaired.audit
      : result.baseline.audit;
    const semanticAudit = semanticFromLabAudit(finalLabAudit, "image-lab-auditor");
    const learning = await recordChatImageGenerationTrial(ownerKey, {
      prompt,
      model: finalImage.model,
      mediaType: finalImage.mediaType,
      mode: "audited",
      runtimeMs: Date.now() - startedAt,
      attempts: result.repaired ? 2 : 1,
      audit: semanticAudit,
    }).catch((error) => {
      console.error("Khasroy audited image learning trial failed", error);
      return null;
    });

    if (!semanticAudit.passed) {
      await rememberImageGenerationFailure(ownerKey, { prompt, audit: semanticAudit }).catch(() => undefined);
      return NextResponse.json(
        {
          ok: false,
          error: "Image Lab закончил цикл, но финальный кадр не прошёл визуальный экзамен.",
          code: "image_semantic_verification_failed",
          audit: semanticAudit,
          learning,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      lab: "Khasroy Image Generation Lab",
      mode: "audited",
      image: `data:${finalImage.mediaType};base64,${finalImage.base64}`,
      model: finalImage.model,
      baseline: {
        model: result.baseline.model,
        sha256: result.baseline.sha256,
        audit: result.baseline.audit,
      },
      repaired: result.repaired
        ? {
            model: result.repaired.model,
            sha256: result.repaired.sha256,
            audit: result.repaired.audit,
          }
        : null,
      delta: result.delta,
      improved: result.improved,
      audit: semanticAudit,
      learning,
    });
  } catch (error) {
    console.error("Khasroy audited Image Lab failed, trying semantic emergency loop", error);

    try {
      const outcome = await runVerifiedEmergencyImage({
        ownerKey,
        apiKey,
        prompt,
        startedAt,
        mode: "emergency_semantic_fallback",
      });

      if (!outcome.audit.passed) {
        return NextResponse.json(
          {
            ok: false,
            error: "Резервная генерация тоже не прошла визуальный экзамен. Плохой результат скрыт, ошибка сохранена для обучения.",
            code: "image_semantic_verification_failed",
            audit: outcome.audit,
            attempts: outcome.attempts,
            learning: outcome.learning,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        ok: true,
        lab: "Khasroy Image Generation Lab",
        mode: "emergency_semantic_fallback",
        image: outcome.image.image,
        model: outcome.image.model,
        baseline: null,
        repaired: outcome.attempts > 1 ? { semanticRetry: true } : null,
        delta: 0,
        improved: outcome.attempts > 1,
        audit: outcome.audit,
        attempts: outcome.attempts,
        learning: outcome.learning,
      });
    } catch (fallbackError) {
      const primary = error instanceof Error ? error.message : "unknown image lab error";
      const fallback = fallbackError instanceof Error ? fallbackError.message : "unknown fallback error";
      console.error("Khasroy semantic Image Lab fallback failed", fallbackError);
      return NextResponse.json(
        {
          ok: false,
          error: "image_lab_failed",
          detail: `${primary}; fallback: ${fallback}`.slice(0, 400),
        },
        { status: 502 },
      );
    }
  }
}
