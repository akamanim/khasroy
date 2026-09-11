import { NextResponse } from "next/server";
import { loadSignedPreview } from "@/lib/site-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) return new NextResponse("Preview unavailable", { status: 503 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig") || "";

  try {
    const html = await loadSignedPreview(ownerKey, id, expires, sig);
    if (!html) return new NextResponse("Preview not found or expired", { status: 404 });

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=300",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      },
    });
  } catch (error) {
    console.error("Khasroy site preview failed", error);
    return new NextResponse("Preview unavailable", { status: 502 });
  }
}
