import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { runImageLab } from "@/lib/server-image-lab";
import { recordChatImageGenerationTrial } from "@/lib/server-learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runEmergencyImage(prompt: string) {
  const seed = Date.now() % 2147483647;
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=1024&height=1024&nologo=true&seed=${seed}`;
  const upstream = await fetch(imageUrl, {
    headers: { "user-agent": "Khasroy-Image-Lab/1.0" },
    signal: AbortSignal.timeout(55_000),
    cache: "no-store",
  });

  const mediaType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || !mediaType.startsWith("image/")) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`emergency image provider ${upstream.status}: ${text.slice(0, 180)}`);
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const upstreamModel = upstream.headers.get("x-model-used")?.trim() || "auto";
  return {
    image: `data:${mediaType};base64,${bytes.toString("base64")}`,
    model: `pollinations-${upstreamModel}`,
    mediaType: mediaType.split(";")[0].trim(),
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

  const startedAt = Date.now();

  if (fast) {
    try {
      const emergency = await runEmergencyImage(prompt);
      const learning = await recordChatImageGenerationTrial(ownerKey, {
        prompt,
        model: emergency.model,
        mediaType: emergency.mediaType,
        mode: "fast_emergency",
        runtimeMs: Date.now() - startedAt,
      }).catch((error) => {
        console.error("Khasroy image learning trial failed", error);
        return null;
      });

      return NextResponse.json({
        ok: true,
        lab: "Khasroy Image Generation Lab",
        mode: "fast_emergency",
        image: emergency.image,
        model: emergency.model,
        baseline: null,
        repaired: null,
        delta: 0,
        improved: false,
        learning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown emergency image error";
      console.error("Khasroy emergency image generation failed", error);
      return NextResponse.json(
        { ok: false, error: "image_generation_failed", detail: message.slice(0, 400) },
        { status: 502 },
      );
    }
  }

  try {
    const result = await runImageLab(prompt);
    const finalImage = result.improved && result.repaired ? result.repaired : result.baseline;
    const learning = await recordChatImageGenerationTrial(ownerKey, {
      prompt,
      model: finalImage.model,
      mediaType: finalImage.mediaType,
      mode: "audited",
      runtimeMs: Date.now() - startedAt,
    }).catch((error) => {
      console.error("Khasroy audited image learning trial failed", error);
      return null;
    });

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
      learning,
    });
  } catch (error) {
    console.error("Khasroy audited Image Lab failed, trying emergency fallback", error);

    try {
      const emergency = await runEmergencyImage(prompt);
      const learning = await recordChatImageGenerationTrial(ownerKey, {
        prompt,
        model: emergency.model,
        mediaType: emergency.mediaType,
        mode: "emergency_fallback",
        runtimeMs: Date.now() - startedAt,
      }).catch((learningError) => {
        console.error("Khasroy fallback image learning trial failed", learningError);
        return null;
      });

      return NextResponse.json({
        ok: true,
        lab: "Khasroy Image Generation Lab",
        mode: "emergency_fallback",
        image: emergency.image,
        model: emergency.model,
        baseline: null,
        repaired: null,
        delta: 0,
        improved: false,
        learning,
      });
    } catch (fallbackError) {
      const primary = error instanceof Error ? error.message : "unknown image lab error";
      const fallback = fallbackError instanceof Error ? fallbackError.message : "unknown fallback error";
      console.error("Khasroy Image Lab fallback failed", fallbackError);
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
