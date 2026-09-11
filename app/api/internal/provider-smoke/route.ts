import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { testGatewayConnection } from "@/lib/ai/provider-failover";
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

  const [gateway, selfHosted] = await Promise.all([
    testGatewayConnection(),
    selfHostedHealth(),
  ]);

  return NextResponse.json({
    ok: gateway.ok,
    gateway,
    selfHosted: {
      configured: selfHosted.configured,
      online: selfHosted.online,
      model: selfHosted.model,
    },
  }, { status: gateway.ok ? 200 : 503 });
}
