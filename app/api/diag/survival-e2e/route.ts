import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/server-auth";
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

async function runProbe(origin: string, ownerKey: string, message: string) {
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
    input: message,
    status: response.status,
    ok: response.ok && Boolean(data?.content),
    durationMs: Date.now() - started,
    content: data?.content?.slice(0, 900) || null,
    error: data?.error?.slice(0, 500) || null,
    provider: data?.provider || null,
    model: data?.model || null,
    brainMode: data?.brainMode || null,
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

  const origin = url.origin;
  const probes = [];
  probes.push(await runProbe(origin, ownerKey, "Хасрой"));
  probes.push(
    await runProbe(
      origin,
      ownerKey,
      "Объясни простыми словами, что такое API, в двух предложениях.",
    ),
  );
  probes.push(await runProbe(origin, ownerKey, "Найди свежие новости об ИИ"));

  return NextResponse.json({
    ok: probes.every((probe) => probe.ok),
    probes,
    survivalHealth: providerHealthSnapshot(),
  });
}
