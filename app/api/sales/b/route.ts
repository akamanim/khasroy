import { NextResponse } from "next/server";
import { runFunnelAgent } from "@/lib/sales/agent-b";
import { isStage, type FunnelData } from "@/lib/sales/funnel";
import { loadFunnelSession, saveFunnelTurn, saveLead, salesSession } from "@/lib/sales/server";
import { loadCatalog } from "@/lib/sales/sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function sessionIdFrom(request: Request) {
  const id = request.headers.get("x-session-id")?.trim().toLowerCase() ?? "";
  return UUID.test(id) ? id : "";
}

/** Restores the conversation after a reload: the whole point of variant B is server memory. */
export async function GET(request: Request) {
  const sessionId = sessionIdFrom(request);
  if (!sessionId) return NextResponse.json({ error: "X-Session-Id required" }, { status: 400 });
  try {
    const { session, messages } = await loadFunnelSession(sessionId, 60);
    return NextResponse.json({ stage: session?.stage ?? "greeting", data: session?.data ?? {}, messages });
  } catch (error) {
    console.error("Sales B session load failed", error);
    return NextResponse.json({ error: "Не удалось загрузить диалог." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const sessionId = sessionIdFrom(request);
  if (!sessionId) return NextResponse.json({ error: "X-Session-Id required" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : "";
  if (!message) return NextResponse.json({ error: "Напишите сообщение." }, { status: 400 });

  try {
    const [catalog, stored] = await Promise.all([loadCatalog(), loadFunnelSession(sessionId, 7)]);
    // Simple rate limit: one message per 2 seconds per session.
    if (stored.session && Date.now() - Date.parse(stored.session.last_message_at) < 2000) {
      return NextResponse.json({ error: "Слишком часто. Подождите пару секунд." }, { status: 429 });
    }
    const stage = isStage(stored.session?.stage) ? stored.session.stage : "greeting";
    const data = (stored.session?.data ?? {}) as FunnelData;
    const result = await runFunnelAgent(catalog, stored.messages, message, stage, data);

    await saveFunnelTurn(sessionId, { user: message, assistant: result.reply, stage: result.stage, data: result.data });

    let leadSaved = false;
    if (result.lead) {
      try {
        await saveLead(await salesSession(), result.lead, [...stored.messages, { role: "user", content: message }, { role: "assistant", content: result.reply }]);
        leadSaved = true;
      } catch (error) {
        console.error("Sales B lead save failed", error);
      }
    }
    return NextResponse.json({
      reply: result.reply,
      products: result.products.map(({ id, name, price, photo, link, stock }) => ({ id, name, price, photo, link, stock })),
      leadSaved,
      stage: result.stage,
      data: result.data,
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    });
  } catch (error) {
    console.error("Sales B chat failed", error);
    return NextResponse.json({ error: "Менеджер сейчас не на связи. Попробуйте ещё раз через минуту." }, { status: 502 });
  }
}
