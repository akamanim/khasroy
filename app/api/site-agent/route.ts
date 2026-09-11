import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  createSiteAgentJob,
  extractSiteUrl,
  stepSiteAgentJob,
} from "@/lib/site-agent-job-v3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Every request performs one bounded stage. Upstream calls have their own deadlines
// well below this Vercel ceiling, so the route can always return retryable JSON.
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Site Agent failed.";

  if (/(timeout|TimeoutError|AbortError|aborted|memory save|memory load|preview save|verify skill)/iu.test(message)) {
    return NextResponse.json(
      {
        error: "Текущий этап не дождался внешнего сервиса вовремя. Прогресс сохранён, Хасрой повторит только этот этап.",
        retryable: true,
        retryAfterMs: 2500,
      },
      { status: 503 },
    );
  }

  if (/(429|rate limit|tokens per minute|otpm|quota|request too large)/iu.test(message)) {
    return NextResponse.json(
      {
        error: "Vision-модель временно упёрлась в лимит Groq. Этот этап сохранён и будет повторён.",
        retryable: true,
        retryAfterMs: 65000,
      },
      { status: 429 },
    );
  }

  if (/(screenshot provider|preview HTTP)/iu.test(message)) {
    return NextResponse.json(
      {
        error: "Внешний сервис скриншотов временно не готов. Прогресс сохранён.",
        retryable: true,
        retryAfterMs: 3000,
      },
      { status: 503 },
    );
  }

  if (/invalid compact JSON/iu.test(message)) {
    return NextResponse.json(
      {
        error: "Vision-модель вернула незавершённый JSON. Этап можно повторить без потери прогресса.",
        retryable: true,
        retryAfterMs: 1500,
      },
      { status: 502 },
    );
  }

  const status = /(URL|адрес|локальн|приватн|jobId|не найден)/iu.test(message) ? 400 : 502;
  return NextResponse.json({ error: message, retryable: false }, { status });
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  const apiKey = process.env.GROQ_API_KEY;
  if (!ownerKey || !apiKey) {
    return NextResponse.json({ error: "Site Agent ещё не настроен на сервере." }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
  }

  let body: {
    action?: unknown;
    jobId?: unknown;
    url?: unknown;
    query?: unknown;
    goal?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  try {
    if (body.action === "step") {
      if (typeof body.jobId !== "string" || !body.jobId.trim()) {
        return NextResponse.json({ error: "Не передан jobId Site Agent." }, { status: 400 });
      }
      const result = await stepSiteAgentJob({ ownerKey, apiKey, jobId: body.jobId.trim() });
      return NextResponse.json({ ok: true, ...result });
    }

    const explicitUrl = typeof body.url === "string" ? body.url.trim() : "";
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 4000) : "";
    const resolvedUrl = explicitUrl || (query ? extractSiteUrl(query) : null);
    if (!resolvedUrl) {
      return NextResponse.json({ error: "Передайте URL сайта для аудита." }, { status: 400 });
    }

    const job = await createSiteAgentJob({
      ownerKey,
      origin: new URL(request.url).origin,
      targetUrl: resolvedUrl,
      goal: typeof body.goal === "string" ? body.goal.slice(0, 1200) : query.slice(0, 1200),
    });
    return NextResponse.json({ ok: true, ...job });
  } catch (error) {
    console.error("Khasroy Site Intelligence v3 failed", error);
    return errorResponse(error);
  }
}
