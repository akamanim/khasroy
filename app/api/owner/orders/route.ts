import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { setOrderStatus } from "@/lib/invitations/server";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["submitted", "approved", "published", "archived"]);

/** Owner-only: move an order between new (submitted), paid (approved), published and archived. */
export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { slug?: unknown; status?: unknown } | null;
  const slug = typeof body?.slug === "string" && /^[a-z0-9]{6,24}$/u.test(body.slug) ? body.slug : "";
  const status = typeof body?.status === "string" && ALLOWED.has(body.status) ? body.status : "";
  if (!slug || !status) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    await setOrderStatus(slug, status as "submitted" | "approved" | "published" | "archived");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Order status change failed", error);
    return NextResponse.json({ error: "Не удалось изменить статус." }, { status: 502 });
  }
}
