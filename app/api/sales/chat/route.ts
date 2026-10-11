import { NextResponse } from "next/server";
import { runSalesAgent, type SalesTurn } from "@/lib/sales/agent";
import { saveLead, salesSession } from "@/lib/sales/server";
import { loadCatalog } from "@/lib/sales/sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CHARS = 1000;
const MAX_TURNS = 40;

function turns(value: unknown): SalesTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is SalesTurn =>
      Boolean(t) && typeof t === "object" &&
      ((t as SalesTurn).role === "user" || (t as SalesTurn).role === "assistant") &&
      typeof (t as SalesTurn).content === "string")
    .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }))
    .slice(-MAX_TURNS);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: unknown; history?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_CHARS) : "";
  if (!message) return NextResponse.json({ error: "Напишите сообщение." }, { status: 400 });
  const history = turns(body?.history);
  if (history.length >= MAX_TURNS) {
    return NextResponse.json({ error: "Диалог слишком длинный. Обновите страницу, чтобы начать заново." }, { status: 429 });
  }

  try {
    const catalog = await loadCatalog();
    const result = await runSalesAgent(catalog, history, message);
    let leadSaved = false;
    if (result.lead) {
      try {
        const session = await salesSession();
        await saveLead(session, result.lead, [...history, { role: "user", content: message }, { role: "assistant", content: result.reply }]);
        leadSaved = true;
      } catch (error) {
        console.error("Sales lead save failed", error);
      }
    }
    return NextResponse.json({
      reply: result.reply,
      products: result.products.map(({ id, name, price, photo, link, stock }) => ({ id, name, price, photo, link, stock })),
      leadSaved,
      source: catalog.source,
    });
  } catch (error) {
    console.error("Sales chat failed", error);
    return NextResponse.json({ error: "Менеджер сейчас не на связи. Попробуйте ещё раз через минуту." }, { status: 502 });
  }
}
