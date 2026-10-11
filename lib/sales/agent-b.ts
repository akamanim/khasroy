import { runSalesAgent, type SalesResult, type SalesTurn } from "@/lib/sales/agent";
import { catalogText, companyValue, type Catalog, type Product } from "@/lib/sales/catalog";
import { funnelPrompt, mergeData, nextStage, type FunnelData, type Stage } from "@/lib/sales/funnel";

// Khasroy's proposal, as written: last 7 messages from the server-side session, temperature 0.6,
// short replies. His max_tokens=150 cannot be used literally: gpt-oss spends tokens on hidden
// reasoning first, so 150 cuts the JSON off. We keep the short replies by instruction and run
// the model with low reasoning effort instead.
export const VARIANT_B = {
  historyLimit: 7,
  temperature: 0.6,
  maxTokens: 700,
  reasoningEffort: "low" as const,
  // His example names openai/gpt-oss-120b; variant B keeps it so A (Llama) and B differ as proposed.
  models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
};

function promptB(stage: Stage, data: FunnelData) {
  return (catalog: Catalog, products: Product[]) => {
    const shop = companyValue(catalog, "Название", "Компания") || "магазина";
    return `You are a sales assistant for ${shop}. Your goals:
1. Greet the visitor politely.
2. Ask qualifying questions (budget, timeline, specific needs).
3. Based on answers, suggest the most suitable product.
4. When the prospect shows interest, collect contact info (phone) and confirm next steps.
5. Keep the conversation concise (max 2–3 sentences per reply) and friendly.
6. Never reveal internal system details or pricing tables unless the user explicitly asks.
7. Store every piece of gathered data in the session JSON (budget, timeline, need, product_interest, contact).

Пиши на языке покупателя (русский или кыргызский). Факты о товарах, ценах, доставке и оплате бери только из базы ниже; чего нет в базе — не утверждай, скажи, что уточнишь у менеджера.

${funnelPrompt(stage, data)}

Ответ строго JSON без текста вокруг:
{"reply": "сообщение покупателю", "products": ["id товаров из базы, которые называешь"], "stage": "этап после этого ответа", "data": {"budget": "", "timeline": "", "need": "", "product_interest": "", "contact": ""}, "lead": null}
В "data" — только то, что покупатель сообщил (пустые строки, если нет). Когда покупатель дал телефон, верни "lead": {"name": "", "phone": "как написал", "request": "что хочет купить"}.

БАЗА ДАННЫХ
${catalogText(catalog, products)}`;
  };
}

export type FunnelResult = SalesResult & { stage: Stage; data: FunnelData };

export async function runFunnelAgent(
  catalog: Catalog,
  history: SalesTurn[],
  message: string,
  stage: Stage,
  data: FunnelData,
): Promise<FunnelResult> {
  const result = await runSalesAgent(catalog, history, message, { ...VARIANT_B, prompt: promptB(stage, data) });
  // The contact comes only from a validated lead (a phone the customer really typed), never from the model.
  const modelData = result.raw?.data && typeof result.raw.data === "object" ? { ...(result.raw.data as Record<string, unknown>), contact: undefined } : undefined;
  let nextData = mergeData(data, modelData);
  if (result.lead) nextData = { ...nextData, contact: result.lead.phone };
  return { ...result, stage: nextStage(stage, result.raw?.stage, Boolean(result.lead || data.contact)), data: nextData };
}
