import { NextResponse } from "next/server";
import { recoverPendingTasks } from "@/lib/survival/recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SCHEDULE = "*/10 * * * *";

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

export async function GET(request: Request) {
  if (!isVercelCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized_cron" }, { status: 401 });
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
    console.error("Khasroy survival recovery cron failed", error);
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
