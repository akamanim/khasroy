import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatPayload = {
  content?: string;
  error?: string;
  provider?: string;
  model?: string;
  brainMode?: string;
};

async function send(origin: string, ownerKey: string, prompt: string) {
  const started = Date.now();
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${OWNER_COOKIE}=${ownerSessionToken(ownerKey)}`,
    },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const data = (await response.json().catch(() => null)) as ChatPayload | null;
  return {
    prompt,
    status: response.status,
    durationMs: Date.now() - started,
    content: data?.content?.trim().slice(0, 1200) || null,
    error: data?.error?.trim().slice(0, 500) || null,
    provider: data?.provider || null,
    model: data?.model || null,
    brainMode: data?.brainMode || null,
  };
}

export async function GET(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() || "";
  if (!ownerKey) {
    return NextResponse.json({ ok: false, error: "owner_key_missing" }, { status: 503 });
  }

  const origin = new URL(request.url).origin;
  const prompts = [
    "Хасрой",
    "Привет, Хасрой. Кто ты? Ответь кратко, двумя предложениями.",
    "Объясни одним предложением разницу между оперативной памятью и SSD.",
  ];

  const results = [];
  for (const prompt of prompts) {
    results.push(await send(origin, ownerKey, prompt));
  }

  const ok = results.every(
    (item) => item.status === 200 && Boolean(item.content) && item.brainMode === "chat",
  );
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
