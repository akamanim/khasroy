import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { buildWebsite, webStudioRuntimeStatus } from "@/lib/web-studio";

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
  return NextResponse.json({ ok: true, service: "khasroy-web-studio", runtime: webStudioRuntimeStatus() });
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!ownerKey || !apiKey) {
    return NextResponse.json({ error: "web_studio_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { brief?: unknown; publish?: unknown } | null;
  const brief = typeof body?.brief === "string" ? body.brief.trim().slice(0, 10000) : "";
  if (!brief) return NextResponse.json({ error: "brief_required" }, { status: 400 });

  try {
    const result = await buildWebsite({
      ownerKey,
      apiKey,
      brief,
      publish: body?.publish !== false,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Khasroy Web Studio failed", error);
    const message = error instanceof Error ? error.message : "web_studio_failed";
    return NextResponse.json(
      {
        ok: false,
        error: "Не удалось довести сайт до публикации.",
        detail: message.slice(0, 600),
        runtime: webStudioRuntimeStatus(),
      },
      { status: 502 },
    );
  }
}
