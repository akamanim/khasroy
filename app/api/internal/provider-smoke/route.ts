import { createHash, timingSafeEqual } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { NextResponse } from "next/server";
import { selfHostedHealth } from "@/lib/brain/providers/self-hosted";

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

  const oidc = await getVercelOidcToken().catch(() => "");
  const selfHosted = await selfHostedHealth();
  if (!oidc) return NextResponse.json({ ok: false, oidc: false, selfHosted }, { status: 503 });

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${oidc}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      models: ["openai/gpt-5.6-sol"],
      messages: [{ role: "user", content: "Reply with exactly OK" }],
      max_completion_tokens: 8,
      temperature: 0,
    }),
  });
  const text = await response.text().catch(() => "");
  let parsed: { model?: string; error?: { message?: string; code?: string } | string } | null = null;
  try { parsed = JSON.parse(text) as typeof parsed; } catch { /* text fallback */ }
  const error = parsed?.error;
  const errorMessage = typeof error === "string" ? error : error?.message;
  const errorCode = typeof error === "object" && error ? error.code : undefined;

  return NextResponse.json({
    ok: response.ok,
    oidc: true,
    gateway: {
      status: response.status,
      model: parsed?.model || null,
      errorCode: errorCode || null,
      error: response.ok ? null : (errorMessage || text).slice(0, 300),
    },
    selfHosted: {
      configured: selfHosted.configured,
      online: selfHosted.online,
      model: selfHosted.model,
    },
  }, { status: response.ok ? 200 : 503 });
}
