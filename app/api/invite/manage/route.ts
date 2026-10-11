import { NextResponse } from "next/server";
import { ConflictError, hideWish, NotFoundError, setAlias } from "@/lib/invitations/server";

export const dynamic = "force-dynamic";

/** Organizer actions from the secret guests page; every call carries the page's token. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const token = typeof body?.k === "string" ? body.k : "";
  if (!/^[a-z0-9]{6,24}$/u.test(slug) || !/^[a-f0-9]{32}$/u.test(token)) {
    return NextResponse.json({ error: "Страница не найдена." }, { status: 404 });
  }
  try {
    if (body?.action === "alias") {
      const alias = typeof body.alias === "string" ? body.alias.trim().toLowerCase() : "";
      if (alias && !/^[a-z0-9][a-z0-9-]{2,39}$/u.test(alias)) {
        return NextResponse.json({ error: "Только латинские буквы, цифры и дефис, от 3 до 40 символов." }, { status: 400 });
      }
      return NextResponse.json({ alias: await setAlias(slug, token, alias) });
    }
    if (body?.action === "hide_wish" && typeof body.id === "string") {
      await hideWish(slug, token, body.id, body.hidden !== false);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  } catch (error) {
    if (error instanceof ConflictError) return NextResponse.json({ error: "Такая ссылка уже занята, выберите другую." }, { status: 409 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: "Страница не найдена." }, { status: 404 });
    console.error("Organizer action failed", error);
    return NextResponse.json({ error: "Не удалось сохранить. Попробуйте ещё раз." }, { status: 502 });
  }
}
