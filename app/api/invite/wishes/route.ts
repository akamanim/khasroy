import { NextResponse } from "next/server";
import { addWish, listWishes, NotFoundError } from "@/lib/invitations/server";

export const dynamic = "force-dynamic";

/** Public: the wishes shown on an invitation (hidden ones excluded). */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  try {
    return NextResponse.json({ wishes: await listWishes(slug) });
  } catch (error) {
    console.error("Wishes list failed", error);
    return NextResponse.json({ wishes: [] }, { status: 502 });
  }
}

/** Public: a guest leaves a wish. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { slug?: unknown; name?: unknown; text?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 500) : "";
  if (!name || !text) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await addWish(slug, name, text);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("Wish failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
