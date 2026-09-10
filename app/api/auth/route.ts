import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) {
    return NextResponse.json(
      { error: "KHASROY_OWNER_KEY не настроен на сервере." },
      { status: 503 },
    );
  }

  let body: { key?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  if (typeof body.key !== "string" || !safeEqual(body.key, ownerKey)) {
    return NextResponse.json({ error: "Неверный ключ владельца." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(OWNER_COOKIE, ownerSessionToken(ownerKey), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
