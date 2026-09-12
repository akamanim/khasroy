import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { recoverPendingTasks } from "@/lib/survival/recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SCHEDULE = "*/10 * * * *";
const RECOVERY_TOKEN_HASH = "98cf52b48964f2a08f28254762632522cfae84659c4c833e730112c55bdc634b";

function safeHashEqual(value: string, expectedHex: string) {
  const actual = Buffer.from(createHash("sha256").update(value).digest("hex"));
  const expected = Buffer.from(expectedHex);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isVercelCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";

  if (cronSecret) {
    return authorization === `Bearer ${cronSecret}`;
  }

  const userAgent = request.headers.get("user-agent") || "";
  const schedule = request.headers.get("x-vercel-cron-schedule") || "";
  return userAgent.includes("vercel-cron/1.0") && schedule === CRON_SCHEDULE;
}

function isSupabaseRecoveryHeartbeat(request: Request) {
  const token = request.headers.get("x-khasroy-recovery-token") || "";
  return Boolean(token) && safeHashEqual(token, RECOVERY_TOKEN_HASH);
}

function authorizedRecovery(request: Request) {
  return isVercelCron(request) || isSupabaseRecoveryHeartbeat(request);
}

export async function GET(request: Request) {
  if (!authorizedRecovery(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized_recovery" }, { status: 401 });
  }

  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ ok: false, error: "owner_not_configured" }, { status: 503 });
  }

  try {
    const recovery = await recoverPendingTasks(ownerKey, 1);
    return NextResponse.json({
      ok: true,
      survival: "recovery_cycle_complete",
      ...recovery,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown recovery error";
    console.error("Khasroy survival recovery cycle failed", error);
    return NextResponse.json(
      {
        ok: false,
        survival: "recovery_cycle_failed",
        error: message.slice(0, 400),
      },
      { status: 502 },
    );
  }
}
