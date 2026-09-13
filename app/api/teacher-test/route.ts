import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { runExternalTeacher } from "@/lib/brain/providers/external-teachers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function testGroq() {
  const key = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
  if (!key) {
    return { provider: "groq", configured: false, ok: false, status: 503, model, latencyMs: 0, error: "missing_key" };
  }
  const started = Date.now();
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "This is a connectivity test. Reply with exactly OK." },
          { role: "user", content: "Reply exactly OK" },
        ],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const choices = Array.isArray(payload?.choices) ? payload?.choices : [];
    const first = choices?.[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const text = typeof message?.content === "string" ? message.content.trim() : "";
    return {
      provider: "groq",
      configured: true,
      ok: response.ok && Boolean(text),
      status: response.status,
      model: typeof payload?.model === "string" ? payload.model : model,
      latencyMs: Date.now() - started,
      reply: text || null,
      error: response.ok ? null : "request_failed",
    };
  } catch (error) {
    return {
      provider: "groq",
      configured: true,
      ok: false,
      status: 503,
      model,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "request_failed",
    };
  }
}

async function testExternal(provider: "openai" | "gemini" | "kimi") {
  const run = await runExternalTeacher(provider, {
    systemContent: "This is a connectivity test. Reply with exactly OK.",
    history: [{ role: "user", content: "Reply exactly OK" }],
    maxCompletion: 16,
    timeoutMs: 10_000,
  });
  const text = run.data?.choices?.[0]?.message?.content?.trim() || "";
  return {
    provider,
    configured: run.response.status !== 503 || run.data?.error?.code !== "missing_key",
    ok: run.response.ok && Boolean(text),
    status: run.response.status,
    model: run.model,
    latencyMs: run.latencyMs,
    reply: text || null,
    error: run.data?.error?.message || null,
  };
}

export async function GET() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tests = await Promise.all([
    testGroq(),
    testExternal("openai"),
    testExternal("gemini"),
    testExternal("kimi"),
  ]);

  return NextResponse.json({
    ok: tests.every((test) => test.ok),
    testedAt: new Date().toISOString(),
    tests,
  });
}
