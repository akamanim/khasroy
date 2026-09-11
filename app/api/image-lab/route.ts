import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { runImageLab } from "@/lib/server-image-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt_required" }, { status: 400 });
  }

  try {
    const result = await runImageLab(prompt);
    const finalImage = result.repaired || result.baseline;

    return NextResponse.json({
      ok: true,
      lab: "Khasroy Image Generation Lab",
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown image lab error";
    console.error("Khasroy Image Lab failed", error);
    return NextResponse.json(
      { ok: false, error: "image_lab_failed", detail: message.slice(0, 400) },
      { status: 502 },
    );
  }
}
