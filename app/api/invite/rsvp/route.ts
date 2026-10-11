import { NextResponse } from "next/server";
import { addRsvp, NotFoundError, type RsvpAnswer } from "@/lib/invitations/server";

export const dynamic = "force-dynamic";

const ANSWERS = new Set<RsvpAnswer>(["yes", "family", "no"]);

/** Public endpoint: a guest answers an invitation. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { slug?: unknown; name?: unknown; answer?: unknown; partySize?: unknown }
    | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const name = typeof body?.name === "string" ? body.name.replace(/[\u0000-\u001f]/gu, "").trim().slice(0, 80) : "";
  const answer = typeof body?.answer === "string" && ANSWERS.has(body.answer as RsvpAnswer) ? (body.answer as RsvpAnswer) : null;
  const partySize = Math.min(Math.max(Math.round(Number(body?.partySize) || 2), 2), 30);
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (!answer || !/^[a-z0-9]{6,24}$/u.test(slug)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await addRsvp(slug, name, answer, answer === "family" ? partySize : answer === "yes" ? 1 : 0);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("RSVP failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
