import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { detectImageGenerationIntent } from "@/lib/image-intent";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const intent = detectImageGenerationIntent(text);

  return NextResponse.json(
    intent
      ? { execution: "image_generation", prompt: intent.prompt, confidence: intent.confidence }
      : { execution: "brain" },
  );
}
