import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EXPECTED = "f75d069aa09908b3d00e2db8c99e591cdd44e0f8008f95e03e81a3dac1ac12d4";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeToken(value: string) {
  const a = Buffer.from(digest(value));
  const b = Buffer.from(EXPECTED);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!safeToken(token)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const credential = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
  if (!credential) return NextResponse.json({ ok: false, configured: false }, { status: 503 });

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      models: ["openai/gpt-5.6-sol"],
      messages: [{ role: "user", content: "Reply with exactly OK" }],
      max_completion_tokens: 8,
      temperature: 0,
    }),
  });
  const data = await response.json().catch(() => null) as { model?: string; error?: { message?: string } } | null;
  return NextResponse.json({
    ok: response.ok,
    configured: true,
    status: response.status,
    model: data?.model || null,
    error: response.ok ? null : data?.error?.message?.slice(0, 160) || "gateway error",
  }, { status: response.ok ? 200 : 502 });
}
