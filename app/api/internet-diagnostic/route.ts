import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, stage: "config", error: "missing_groq_api_key" }, { status: 503 });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [{ role: "user", content: "Search the web for the current UTC year and answer with one short sentence." }],
        max_completion_tokens: 200,
        stream: false,
        compound_custom: {
          tools: { enabled_tools: ["web_search"] },
        },
      }),
    });

    const data = await response.json().catch(() => null) as {
      model?: string;
      choices?: Array<{ message?: { content?: string; executed_tools?: Array<{ type?: string; name?: string }> } }>;
      error?: { message?: string; type?: string; code?: string };
    } | null;

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      model: data?.model,
      toolCount: data?.choices?.[0]?.message?.executed_tools?.length ?? 0,
      toolTypes: data?.choices?.[0]?.message?.executed_tools?.map((tool) => tool.type || tool.name || "unknown") ?? [],
      hasContent: Boolean(data?.choices?.[0]?.message?.content),
      error: data?.error ? {
        type: data.error.type,
        code: data.error.code,
        message: data.error.message?.slice(0, 300),
      } : undefined,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stage: "network",
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    }, { status: 502 });
  }
}
