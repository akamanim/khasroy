import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/server-auth";
import { runBrain } from "@/lib/brain/router";
import {
  buildMemoryContext,
  getRecentMessages,
  recallKnowledge,
} from "@/lib/server-memory";
import { providerHealthSnapshot } from "@/lib/survival/provider-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPECTED_TOKEN_HASH = "1a46240a888d1c8041c7bc9b95d7b5ce357cdc86b82f35b31866b56c49e372e4";

function validToken(value: string) {
  const actual = Buffer.from(createHash("sha256").update(value).digest("hex"));
  const expected = Buffer.from(EXPECTED_TOKEN_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type ChatPayload = {
  content?: string;
  error?: string;
  provider?: string;
  model?: string;
  brainMode?: string;
};

async function runChatProbe(origin: string, ownerKey: string, message: string) {
  const started = Date.now();
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${OWNER_COOKIE}=${ownerSessionToken(ownerKey)}`,
    },
    body: JSON.stringify({ messages: [{ role: "user", content: message }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const data = (await response.json().catch(() => null)) as ChatPayload | null;
  return {
    status: response.status,
    ok: response.ok && Boolean(data?.content),
    durationMs: Date.now() - started,
    content: data?.content?.slice(0, 700) || null,
    error: data?.error?.slice(0, 500) || null,
    provider: data?.provider || null,
    model: data?.model || null,
    brainMode: data?.brainMode || null,
  };
}

async function runDirectBrainProbe(ownerKey: string) {
  const started = Date.now();
  const [recent, knowledge] = await Promise.all([
    getRecentMessages(ownerKey, 20),
    recallKnowledge(ownerKey, "", 12),
  ]);
  const memoryContext = buildMemoryContext(recent, knowledge);
  const systemContent = `Ты — Хасрой, универсальный AI-союзник владельца системы.${memoryContext}`;
  const brain = await runBrain({
    apiKey: process.env.GROQ_API_KEY?.trim() || "",
    defaultModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
    systemContent,
    history: [{ role: "user", content: "Хасрой" }],
    query: "Хасрой",
    repositoryRead: false,
  });

  return {
    durationMs: Date.now() - started,
    status: brain.response.status,
    ok: brain.response.ok && Boolean(brain.data?.choices?.[0]?.message?.content?.trim()),
    provider: brain.provider,
    providerDetail: brain.providerDetail,
    model: brain.model,
    mode: brain.mode,
    content: brain.data?.choices?.[0]?.message?.content?.trim().slice(0, 700) || null,
    errorType: brain.data?.error?.type || null,
    errorCode: brain.data?.error?.code || null,
    errorMessage: brain.data?.error?.message?.slice(0, 500) || null,
    memoryChars: memoryContext.length,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!validToken(url.searchParams.get("token") || "")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() || "";
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_key_missing" }, { status: 503 });
  }

  const [directBrain, chat] = await Promise.all([
    runDirectBrainProbe(ownerKey),
    runChatProbe(url.origin, ownerKey, "Хасрой"),
  ]);

  return NextResponse.json({
    ok: directBrain.ok && chat.ok,
    directBrain,
    chat,
    survivalHealth: providerHealthSnapshot(),
  });
}
