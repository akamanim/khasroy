import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  extractSiteUrl,
  formatSiteAgentChatResponse,
  recordVerifiedSiteAgentSkills,
  runFullSiteAgent,
} from "@/lib/site-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function friendlySiteAgentError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Site Agent failed.";
  if (/(429|rate limit|tokens per minute|otpm|quota|request too large)/iu.test(raw)) {
    return {
      status: 429,
      message: "Vision-модель временно упёрлась в бесплатный лимит Groq. Token budget уже снижен; если лимит занят предыдущим запросом, подождите около минуты и повторите.",
    };
  }
  if (/invalid compact JSON|invalid JSON/iu.test(raw)) {
    return {
      status: 502,
      message: "Vision-модель оборвала компактный JSON. Повторите аудит — незавершённый прогон не будет записан как VERIFIED.",
    };
  }
  if (/(URL|адрес|http|локальн|приватн)/iu.test(raw)) return { status: 400, message: raw };
  if (/screenshot provider/iu.test(raw)) {
    return { status: 502, message: "Сервис скриншотов временно не подготовил страницу. Повторите запрос через несколько секунд." };
  }
  return {
    status: 502,
    message: "Site Agent не смог завершить полный цикл. Незавершённые навыки останутся LEARNING; попробуйте ещё раз.",
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
    await recordVerifiedSiteAgentSkills(ownerKey, result);
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
