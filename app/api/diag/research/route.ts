import { NextResponse } from "next/server";
import { searchWebDirect } from "@/lib/server-web";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const started = Date.now();
  try {
    const result = await searchWebDirect("свежие новости об искусственном интеллекте", 4);
    return NextResponse.json({
      ok: true,
      provider: result.provider,
      durationMs: Date.now() - started,
      sourceCount: result.sources.length,
      sources: result.sources.map((source) => ({
        title: source.title,
        url: source.url,
      })),
      hasAnswer: Boolean(result.answer?.trim()),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message.slice(0, 1500) : "unknown error",
      },
      { status: 502 },
    );
  }
}
