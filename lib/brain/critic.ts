export type CriticMode = "repository" | "sandbox" | "research" | "agentic" | "technical";

export type CriticResult = {
  ran: boolean;
  passed: boolean;
  revised: boolean;
  answer: string;
  notes: string[];
  model?: string;
};

type CriticApiResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

function looksTechnical(query: string) {
  return /(код|программ|архитектур|api|typescript|javascript|python|react|next\.?js|github|репозитор|ошибк|bug|debug|сервер|база|sql|supabase|vercel|функци|алгоритм|скрипт|тест|интернет.*источник|исследуй|проверь)/iu.test(
    query,
  );
}

export function shouldRunCritic(
  query: string,
  brainMode: string,
  answer: string,
) {
  if (answer.length < 80) return false;
  if (["repository", "sandbox", "research", "agentic"].includes(brainMode)) return true;
  return looksTechnical(query);
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeNotes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export async function runCritic(args: {
  apiKey: string;
  query: string;
  answer: string;
  mode: CriticMode;
  evidence?: string;
}): Promise<CriticResult> {
  const model = process.env.GROQ_CRITIC_MODEL || "openai/gpt-oss-20b";
  const evidence = (args.evidence || "").slice(0, 5_000);
  const answer = args.answer.slice(0, 8_000);

  const system = `Ты — независимый технический критик Хасроя.
Твоя задача — проверить черновой ответ перед показом владельцу.
Проверяй только то, что реально можно проверить из запроса и переданных доказательств.
Не придумывай ошибки ради критики. Если ответ корректен — оставь его.
Если есть фактическая, логическая или техническая ошибка — исправь её.
Не раскрывай секреты, API-ключи и внутренние токены.

Верни ТОЛЬКО JSON без markdown в формате:
{"passed":true|false,"revised":true|false,"answer":"финальный ответ пользователю","notes":["краткая причина"]}

passed=true означает, что финальный answer пригоден к отправке владельцу.
revised=true только если ты реально изменил исходный ответ.`;

  const user = `Режим: ${args.mode}
Запрос владельца:
${args.query.slice(0, 3_500)}

Черновой ответ Хасроя:
${answer}

Проверяемые доказательства/контекст:
${evidence || "Дополнительных доказательств не передано."}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: 850,
      reasoning_effort: "low",
      stream: false,
    }),
  });

  if (!response.ok) {
    return {
      ran: false,
      passed: true,
      revised: false,
      answer: args.answer,
      notes: [`critic_http_${response.status}`],
    };
  }

  const data = (await response.json().catch(() => null)) as CriticApiResponse | null;
  const raw = data?.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    return {
      ran: false,
      passed: true,
      revised: false,
      answer: args.answer,
      notes: ["critic_empty_response"],
    };
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    return {
      ran: false,
      passed: true,
      revised: false,
      answer: args.answer,
      notes: ["critic_invalid_json"],
    };
  }

  const finalAnswer =
    typeof parsed.answer === "string" && parsed.answer.trim()
      ? parsed.answer.trim()
      : args.answer;

  return {
    ran: true,
    passed: parsed.passed !== false,
    revised: parsed.revised === true && finalAnswer !== args.answer,
    answer: finalAnswer,
    notes: normalizeNotes(parsed.notes),
    model: data?.model || model,
  };
}
