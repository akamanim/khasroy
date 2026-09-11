import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getRecentAutonomyRuns } from "@/lib/server-autonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SCHEDULE = "17 22 * * *";
const SIGNATURE_CONTEXT = "khasroy-autonomy-v1";
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

function isVercelCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";

  if (cronSecret) {
    return authorization === `Bearer ${cronSecret}`;
  }

  // Fallback for projects where CRON_SECRET has not been provisioned yet.
  // It is intentionally paired with a persistent 20h throttle below, so a
  // spoofed request cannot repeatedly consume the AI quota or mutate production.
  const userAgent = request.headers.get("user-agent") || "";
  const schedule = request.headers.get("x-vercel-cron-schedule") || "";
  return userAgent.includes("vercel-cron/1.0") && schedule === CRON_SCHEDULE;
}

function signatureFor(ownerKey: string, timestamp: string) {
  const hash = createHash("sha256").update(ownerKey).digest("hex");
  return createHmac("sha256", hash)
    .update(`${timestamp}:${SIGNATURE_CONTEXT}`)
    .digest("hex");
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
    const recent = await getRecentAutonomyRuns(ownerKey, 12);
    const lastVisionRun = recent.find((run) => run.phase.startsWith("vision_school"));
    const lastStarted = lastVisionRun?.started_at
      ? new Date(lastVisionRun.started_at).getTime()
      : 0;

    if (lastStarted && Date.now() - lastStarted < MIN_INTERVAL_MS) {
      return NextResponse.json({
        ok: true,
        school: "skipped_recent_cycle",
        lastRunAt: lastVisionRun?.started_at,
      });
    }

    const timestamp = Date.now().toString();
    const endpoint = new URL("/api/vision-school/run", request.url);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "x-khasroy-timestamp": timestamp,
        "x-khasroy-signature": signatureFor(ownerKey, timestamp),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown cron error";
    console.error("Vision School cron failed", error);
    return NextResponse.json(
      { ok: false, school: "cron_failed", error: message.slice(0, 240) },
      { status: 502 },
    );
  }
}
