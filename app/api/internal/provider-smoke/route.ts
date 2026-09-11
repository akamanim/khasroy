import { createHash, timingSafeEqual } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { NextResponse } from "next/server";
import { selfHostedHealth } from "@/lib/brain/providers/self-hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const EXPECTED = "68a684ac1baf9489e2a62ae60ae57436466e58dc09c2ebe3e48c28d4cd96baac";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeToken(value: string) {
  const a = Buffer.from(digest(value));
  const b = Buffer.from(EXPECTED);
  return a.length === b.length && timingSafeEqual(a, b);
}

type GatewayPayload = {
  model?: string;
  error?: { message?: string; code?: string };
};

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
  const data = (await response.json().catch(() => null)) as GatewayPayload | null;

  return NextResponse.json({
    ok: response.ok,
    oidc: true,
    gateway: {
      status: response.status,
      model: data?.model || null,
      errorCode: data?.error?.code || null,
      error: response.ok ? null : data?.error?.message?.slice(0, 300) || "gateway error",
    },
    selfHosted: {
      configured: selfHosted.configured,
      online: selfHosted.online,
      model: selfHosted.model,
    },
  }, { status: response.ok ? 200 : 503 });
}