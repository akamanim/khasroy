import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  extractSiteUrl,
  formatSiteAgentChatResponse,
  recordVerifiedSiteAgentSkills,
  runFullSiteAgent,
} from "@/lib/site-agent-v3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function friendlySiteAgentError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Site Agent failed.";
  const stage = raw.match(/^\[([A-Z_]+)\]/u)?.[1] || "UNKNOWN";

  if (/(429|rate limit|tokens per minute|otpm|quota|request too large)/iu.test(raw)) {
    return {
      status: 429,
      message: `Site Agent остановился на этапе ${stage}: vision-модель временно упёрлась в лимит Groq. Подождите около минуты и повторите. Незавершённый прогон не станет VERIFIED.`,
    };
  }
  if (/invalid compact JSON|invalid JSON/iu.test(raw)) {
    return {
      status: 502,
      message: `Site Agent остановился на этапе ${stage}: vision-модель оборвала компактный JSON. Повторите аудит; незавершённый прогон не станет VERIFIED.`,
    };
  }
  if (/(URL|адрес|http|локальн|приватн)/iu.test(raw)) return { status: 400, message: raw };
  if (/screenshot provider/iu.test(raw)) {
    return {
      status: 502,
      message: `Site Agent остановился на этапе ${stage}: сервис скриншотов не успел подготовить изображение даже после расширенного ожидания. Незавершённый прогон останется LEARNING.`,
    };
  }
  return {
    status: 502,
    message: `Site Agent остановился на этапе ${stage}. Незавершённые навыки останутся LEARNING; повторите запрос.`,
  };
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  const apiKey = process.env.GROQ_API_KEY;
  if (!ownerKey || !apiKey) {
    return NextResponse.json({ error: "site_agent_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
  }

  let body: { url?: unknown; query?: unknown; goal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const explicitUrl = typeof body.url === "string" ? body.url.trim() : "";
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 4000) : "";
  const resolvedUrl = explicitUrl || (query ? extractSiteUrl(query) : null);
  if (!resolvedUrl) {
    return NextResponse.json({ error: "Передайте URL сайта для аудита." }, { status: 400 });
  }

  try {
    const result = await runFullSiteAgent({
      ownerKey,
      apiKey,
      origin: new URL(request.url).origin,
      targetUrl: resolvedUrl,
      goal: typeof body.goal === "string" ? body.goal.slice(0, 1200) : query.slice(0, 1200),
    });

    if (result.repair.success) {
      await recordVerifiedSiteAgentSkills(ownerKey, result);
    }

    return NextResponse.json({
      ok: true,
      verified: result.repair.success,
      content: formatSiteAgentChatResponse(result),
      result,
    });
  } catch (error) {
    console.error("Khasroy Site Agent failed", error);
    const friendly = friendlySiteAgentError(error);
    return NextResponse.json({ error: friendly.message }, { status: friendly.status });
  }
}
