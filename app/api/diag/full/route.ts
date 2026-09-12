import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/server-auth";
import { selfHostedHealth } from "@/lib/brain/providers/self-hosted";
import {
  providerFailoverInfo,
  testGatewayConnection,
} from "@/lib/ai/provider-failover";
import { getRecentMessages } from "@/lib/server-memory";
import { searchWebDirect } from "@/lib/server-web";
import { runCodeSandbox } from "@/lib/server-sandbox";

export const runtime = "nodejs";
export const maxDuration = 60;

type Check = {
  ok: boolean;
  durationMs: number;
  [key: string]: unknown;
};

async function check(
  fn: () => Promise<Record<string, unknown>>,
): Promise<Check> {
  const started = Date.now();
  try {
    return { ok: true, durationMs: Date.now() - started, ...(await fn()) };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message.slice(0, 700) : "unknown_error",
    };
  }
}

export async function GET(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() || "";
  const groqKey = process.env.GROQ_API_KEY?.trim() || "";
  const origin = new URL(request.url).origin;

  const environment = {
    ownerKey: Boolean(ownerKey),
    groqKey: Boolean(groqKey),
    groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    aiGatewayStaticKey: Boolean(process.env.AI_GATEWAY_API_KEY?.trim()),
    vercelRuntime: Boolean(process.env.VERCEL),
    directSelfHostedBaseUrl: Boolean(process.env.KHASROY_SELF_HOSTED_BASE_URL?.trim()),
    directSelfHostedModel: Boolean(process.env.KHASROY_SELF_HOSTED_MODEL?.trim()),
    brainGateway: process.env.KHASROY_BRAIN_GATEWAY?.trim()
      ? "custom"
      : "default-supabase",
    emergencyGateway: process.env.KHASROY_EMERGENCY_CHAT_GATEWAY?.trim()
      ? "custom"
      : "default-supabase",
  };

  const selfHosted = await check(async () => {
    const state = await selfHostedHealth();
    return { ...state };
  });

  const memory = await check(async () => {
    if (!ownerKey) throw new Error("owner_key_missing");
    const rows = await getRecentMessages(ownerKey, 1);
    return { reachable: true, rows: rows.length };
  });

  const gateway = await check(async () => {
    const result = await testGatewayConnection();
    return { ...result };
  });

  const effectiveGroq = await check(async () => {
    if (!groqKey) throw new Error("groq_key_missing");
    const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly GROQ_OK" }],
        max_completion_tokens: 16,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await response.json().catch(() => null)) as
      | { model?: string; choices?: Array<{ message?: { content?: string } }>; error?: { message?: string; code?: string } }
      | null;
    return {
      status: response.status,
      provider: response.headers.get("x-khasroy-ai-provider") || "groq-primary",
      routedModel: response.headers.get("x-khasroy-ai-model") || data?.model || model,
      content: data?.choices?.[0]?.message?.content?.trim().slice(0, 160) || null,
      error: data?.error?.message?.slice(0, 280) || null,
      errorCode: data?.error?.code || null,
    };
  });

  const emergency = await check(async () => {
    if (!ownerKey) throw new Error("owner_key_missing");
    const ownerHash = createHash("sha256").update(ownerKey).digest("hex");
    const endpoint =
      process.env.KHASROY_EMERGENCY_CHAT_GATEWAY?.trim() ||
      "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-chat-live";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `khasroy_live_owner=${ownerHash}`,
      },
      body: JSON.stringify({
        action: "chat",
        message: "Ответь точно: EMERGENCY_OK",
        history: [{ role: "user", content: "Ответь точно: EMERGENCY_OK" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const data = (await response.json().catch(() => null)) as
      | { content?: string; model?: string; error?: string }
      | null;
    return {
      status: response.status,
      model: data?.model || null,
      content: data?.content?.trim().slice(0, 180) || null,
      error: data?.error || null,
    };
  });

  const research = await check(async () => {
    const result = await searchWebDirect("искусственный интеллект AI", 3);
    return {
      provider: result.provider,
      sourceCount: result.sources.length,
      firstTitle: result.sources[0]?.title?.slice(0, 180) || null,
    };
  });

  const sandbox = await check(async () => {
    const result = await runCodeSandbox({
      language: "python",
      code: "print('SANDBOX_OK')",
    });
    return {
      runtime: result.runtime,
      exitCode: result.exitCode,
      stdout: result.stdout.slice(0, 100),
    };
  });

  const endToEndChat = await check(async () => {
    if (!ownerKey) throw new Error("owner_key_missing");
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${OWNER_COOKIE}=${ownerSessionToken(ownerKey)}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: "Системная диагностика: ответь одной короткой фразой «Хасрой работает». Не используй интернет.",
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const data = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    return {
      status: response.status,
      content:
        typeof data?.content === "string" ? data.content.slice(0, 500) : null,
      error: typeof data?.error === "string" ? data.error.slice(0, 500) : null,
      provider: typeof data?.provider === "string" ? data.provider : null,
      model: typeof data?.model === "string" ? data.model : null,
      brainMode: typeof data?.brainMode === "string" ? data.brainMode : null,
    };
  });

  const checks = {
    selfHosted,
    memory,
    gateway,
    effectiveGroq,
    emergency,
    research,
    sandbox,
    endToEndChat,
  };

  const criticalOk =
    memory.ok && research.ok && sandbox.ok && endToEndChat.ok &&
    Number(endToEndChat.status) === 200 && Boolean(endToEndChat.content);

  return NextResponse.json({
    ok: criticalOk,
    environment,
    failover: providerFailoverInfo(),
    checks,
  });
}
