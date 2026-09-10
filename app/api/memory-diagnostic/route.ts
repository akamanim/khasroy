import { NextResponse } from "next/server";
import { appendMessage, getRecentMessages } from "@/lib/server-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAGNOSTIC_OWNER = "khasroy-diagnostic-owner-2026";

export async function GET() {
  const marker = `health-check:${Date.now()}`;

  try {
    await appendMessage(DIAGNOSTIC_OWNER, "system", marker);
    const recent = await getRecentMessages(DIAGNOSTIC_OWNER, 10);
    const roundTrip = recent.some((message) => message.content === marker);

    return NextResponse.json({
      ok: roundTrip,
      memoryService: "reachable",
      write: roundTrip ? "ok" : "not_verified",
      read: "ok",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        memoryService: "error",
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
