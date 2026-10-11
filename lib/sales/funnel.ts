// Variant B of the sales assistant, built from Khasroy's own proposal: a server-side session,
// a sales funnel (greeting → qualification → proposal → closing → finished) and a JSON
// record of what the customer told us. Pure logic, no I/O, so it can be unit-tested.

export const STAGES = ["greeting", "qualification", "proposal", "closing", "finished"] as const;
export type Stage = (typeof STAGES)[number];

export type FunnelData = {
  budget?: string;
  timeline?: string;
  need?: string;
  product_interest?: string;
  contact?: string;
};

const DATA_KEYS = ["budget", "timeline", "need", "product_interest", "contact"] as const;

/** Stage goals given to the model (Khasroy's config, adapted from building supplies to any shop). */
export const FUNNEL: Record<Stage, { goal: string; questions?: Array<{ key: keyof FunnelData; text: string }>; next: Stage }> = {
  greeting: {
    goal: "Поприветствуй и спроси, что человек ищет.",
    next: "qualification",
  },
  qualification: {
    goal: "Задай уточняющие вопросы, по одному за раз, только те, ответов на которые ещё нет.",
    questions: [
      { key: "need", text: "Что именно нужно и для кого / по какому поводу?" },
      { key: "budget", text: "Какой бюджет?" },
      { key: "timeline", text: "К какому сроку нужно?" },
    ],
    next: "proposal",
  },
  proposal: {
    goal: "Исходя из ответов, предложи 1–2 самых подходящих товара из базы и спроси, хочет ли человек оформить.",
    next: "closing",
  },
  closing: {
    goal: "Человек заинтересован: попроси телефон и подтверди следующий шаг (менеджер свяжется).",
    next: "finished",
  },
  finished: {
    goal: "Контакт получен. Поблагодари, ответь на оставшиеся вопросы, не проси контакт повторно.",
    next: "finished",
  },
};

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

/**
 * The model proposes the next stage; we only allow staying, moving forward, or stepping back to
 * qualification (the customer changed their mind). "finished" requires a saved contact.
 */
export function nextStage(current: Stage, proposed: unknown, hasContact: boolean): Stage {
  if (hasContact) return "finished";
  const target = isStage(proposed) ? proposed : current;
  if (target === "finished") return "closing";
  const from = STAGES.indexOf(current);
  const to = STAGES.indexOf(target);
  if (to >= from || target === "qualification") return target;
  return current;
}

/** Merges new facts about the customer into the session record; empty values never erase old ones. */
export function mergeData(current: FunnelData, update: unknown): FunnelData {
  const next: FunnelData = { ...current };
  if (!update || typeof update !== "object") return next;
  const u = update as Record<string, unknown>;
  for (const key of DATA_KEYS) {
    const value = u[key];
    if (typeof value === "string" && value.trim()) next[key] = value.trim().slice(0, 200);
    else if (typeof value === "number" && Number.isFinite(value)) next[key] = String(value);
  }
  return next;
}

export function funnelPrompt(stage: Stage, data: FunnelData): string {
  const step = FUNNEL[stage];
  const known = DATA_KEYS.filter((k) => data[k]).map((k) => `${k}: ${data[k]}`).join("; ") || "пока ничего";
  const open = (step.questions ?? []).filter((q) => !data[q.key]).map((q) => `- ${q.text}`).join("\n");
  return `ВОРОНКА ПРОДАЖ
Текущий этап: ${stage}. Цель этапа: ${step.goal}
${open ? `Ещё не выяснено:\n${open}\n` : ""}Уже известно о покупателе: ${known}.
Этапы по порядку: ${STAGES.join(" → ")}. Переходи дальше, когда цель этапа достигнута; не перескакивай через этапы без причины.`;
}
