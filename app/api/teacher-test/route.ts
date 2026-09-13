import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  runExternalTeacher,
  withExternalTeacherKeys,
  type ExternalTeacherKeys,
} from "@/lib/brain/providers/external-teachers";
import { resolveAISecrets } from "@/lib/server-integrations";
import { testPersistentGateway } from "@/lib/ai/persistent-provider-gate";
import {
  persistProviderFailure,
  persistProviderSuccess,
} from "@/lib/survival/persistent-provider-health";
import type { SurvivalProvider } from "@/lib/survival/provider-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeError(status: number, raw: unknown) {
  const text = typeof raw === "string" ? raw.toLowerCase() : "";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429 && /(credit|billing|balance|insufficient|suspend|recharge)/iu.test(text)) return "billing_blocked";
  if (status === 429 && /(quota|resource_exhausted|resource exhausted|daily|tokens per day|limit reached|rate limit)/iu.test(text)) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (/timeout|abort/iu.test(text)) return "timeout";
  return status >= 500 ? "upstream_unavailable" : "request_failed";
}

async function persistResult(
  provider: SurvivalProvider,
  result: { ok: boolean; status: number; latencyMs: number; rawError?: unknown },
) {
  if (result.ok) {
    await persistProviderSuccess(provider, result.status, result.latencyMs);
    return;
  }
  await persistProviderFailure(provider, {
    status: result.status,
    error: result.rawError,
    latencyMs: result.latencyMs,
  });
}

async function testGroq(key: string) {
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
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const text = typeof message?.content === "string" ? message.content.trim() : "";
    const upstreamError = payload?.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>).message
      : null;
    const latencyMs = Date.now() - started;
    const ok = response.ok && Boolean(text);
    await persistResult("groq", { ok, status: response.status, latencyMs, rawError: upstreamError });
    return {
      provider: "groq",
      configured: true,
      ok,
      status: response.status,
      model: typeof payload?.model === "string" ? payload.model : model,
      latencyMs,
      reply: text || null,
      error: ok ? null : safeError(response.status, upstreamError),
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    await persistResult("groq", { ok: false, status: 503, latencyMs, rawError: error });
    return {
      provider: "groq",
      configured: true,
      ok: false,
      status: 503,
      model,
      latencyMs,
      error: safeError(503, error instanceof Error ? error.message : "request_failed"),
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
  const rawError = run.data?.error?.message || null;
  const ok = run.response.ok && Boolean(text);
  await persistResult(provider, {
    ok,
    status: run.response.status,
    latencyMs: run.latencyMs,
    rawError,
  });
  return {
    provider,
    configured: run.response.status !== 503 || run.data?.error?.code !== "missing_key",
    ok,
    status: run.response.status,
    model: run.model,
    latencyMs: run.latencyMs,
    reply: text || null,
    error: ok ? null : safeError(run.response.status, rawError),
  };
}

async function testGateway() {
  const run = await testPersistentGateway();
  return {
    provider: "vercel-gateway",
    configured: run.configured,
    ok: run.ok,
    status: run.status,
    model: run.model,
    latencyMs: run.latencyMs,
    reply: run.ok ? "OK" : null,
    error: run.ok ? null : safeError(run.status, "gateway_request_failed"),
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

  const resolved = await resolveAISecrets(ownerKey).catch(() => ({
    groq: process.env.GROQ_API_KEY?.trim() || "",
    teachers: {} as ExternalTeacherKeys,
  }));

  const tests = await withExternalTeacherKeys(resolved.teachers, () =>
    Promise.all([
      testGroq(resolved.groq),
      testExternal("openai"),
      testExternal("gemini"),
      testExternal("kimi"),
      testGateway(),
    ]),
  );

  return NextResponse.json({
    ok: tests.some((test) => test.ok),
    allHealthy: tests.every((test) => test.ok),
    testedAt: new Date().toISOString(),
    credentialSource: "environment-or-encrypted-vault",
    tests,
  });
}
