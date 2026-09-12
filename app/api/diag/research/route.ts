import { NextResponse } from "next/server";
import { runBrain } from "@/lib/brain/router";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const started = Date.now();
  const query = "Найди свежие новости об ИИ";

  try {
    const run = await runBrain({
      apiKey: process.env.GROQ_API_KEY?.trim() || "",
      defaultModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      systemContent:
        "Ты — Хасрой. Отвечай по-русски и используй только реально найденные веб-источники для свежих фактов.",
      history: [{ role: "user", content: query }],
      query,
      repositoryRead: false,
    });

    const content = run.data?.choices?.[0]?.message?.content?.trim() || "";
    return NextResponse.json(
      {
        ok: run.response.ok && Boolean(content),
        upstreamStatus: run.response.status,
        durationMs: Date.now() - started,
        brainMode: run.mode,
        provider: run.providerDetail,
        model: run.model,
        toolsUsed: run.toolsUsed,
        sourceCount: run.sources.length,
        sources: run.sources.slice(0, 4),
        content: content.slice(0, 3500),
      },
      { status: run.response.ok && content ? 200 : 502 },
    );
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
