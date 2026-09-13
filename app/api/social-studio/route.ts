import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  createSocialDraft,
  getInstagramRuntimeStatus,
  instagramRuntimeStatus,
  publishInstagram,
} from "@/lib/social-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const instagram = await getInstagramRuntimeStatus(ownerKey).catch(() => instagramRuntimeStatus());
  return NextResponse.json({ ok: true, service: "khasroy-social-studio", instagram });
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  const apiKey = process.env.GROQ_API_KEY?.trim() || "";
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    request?: unknown;
    mediaUrl?: unknown;
    caption?: unknown;
    contentType?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "draft";

  try {
    if (action === "publish") {
      const mediaUrl = typeof body?.mediaUrl === "string" ? body.mediaUrl.trim() : "";
      const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
      const contentType = ["reel", "post", "story", "carousel"].includes(String(body?.contentType))
        ? String(body?.contentType) as "reel" | "post" | "story" | "carousel"
        : "post";
      const result = await publishInstagram({ ownerKey, mediaUrl, caption, contentType });
      return NextResponse.json({ ok: true, published: result, instagram: await getInstagramRuntimeStatus(ownerKey) });
    }

    const requestText = typeof body?.request === "string" ? body.request.trim().slice(0, 8000) : "";
    if (!requestText) return NextResponse.json({ error: "request_required" }, { status: 400 });
    const result = await createSocialDraft({ ownerKey, apiKey, request: requestText });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Khasroy Social Studio failed", error);
    const detail = error instanceof Error ? error.message : "social_studio_failed";
    const instagram = await getInstagramRuntimeStatus(ownerKey).catch(() => instagramRuntimeStatus());
    return NextResponse.json({ ok: false, error: "SMM-задача не завершена.", detail: detail.slice(0, 500), instagram }, { status: 502 });
  }
}
