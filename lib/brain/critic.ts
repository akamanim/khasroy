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
    .slice(0, 6);
}

async function callCritic(args: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxCompletion: number;
}) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      max_completion_tokens: args.maxCompletion,
      reasoning_effort: "low",
      stream: false,
      response_format: { type: "json_object" },
    }),
  });

  const data = (await response.json().catch(() => null)) as CriticApiResponse | null;
  const raw = data?.choices?.[0]?.message?.content?.trim() || "";
  return { response, data, parsed: raw ? extractJson(raw) : null };
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
  const draft = args.answer.slice(0, 10_000);

  const reviewSystem = `Ты — независимый технический критик Хасроя.
Проверь черновой ответ до показа владельцу.
Ищи только реальные фактические, логические, алгоритмические и технические ошибки.
Особенно проверяй код, граничные случаи, сложность алгоритма и утверждения о том, что решение было реально запущено/проверено.
Не придумывай ошибки ради критики.

Верни ТОЛЬКО компактный JSON:
{"passed":true|false,"issues":["конкретная ошибка и как её исправить"]}

Если существенных ошибок нет, верни passed=true и пустой issues.`;

  const reviewUser = `Режим: ${args.mode}
Запрос владельца:
${args.query.slice(0, 3_500)}

Черновой ответ Хасроя:
${draft}

Проверяемые доказательства/контекст:
${evidence || "Дополнительных доказательств не передано."}`;

  const review = await callCritic({
    apiKey: args.apiKey,
    model,
    system: reviewSystem,
    user: reviewUser,
    maxCompletion: 500,
  });

  if (!review.response.ok || !review.parsed) {
    return {
      ran: false,
      passed: true,
      revised: false,
      answer: args.answer,
      notes: [
        !review.response.ok
          ? `critic_review_http_${review.response.status}`
          : "critic_review_invalid_json",
      ],
      model: review.data?.model || model,
    };
  }

  const issues = normalizeNotes(review.parsed.issues);
  const reviewPassed = review.parsed.passed !== false && issues.length === 0;

  if (reviewPassed) {
    return {
      ran: true,
      passed: true,
      revised: false,
      answer: args.answer,
      notes: [],
      model: review.data?.model || model,
    };
  }

  const repairSystem = `Ты — редактор технического ответа Хасроя.
Независимый критик уже нашёл конкретные ошибки.
Исправь только реальные ошибки, сохрани полезную часть исходного ответа и не добавляй неподтверждённых утверждений.
Если исходный ответ говорил, что код был реально выполнен, но доказательства этого нет — замени это на честное описание статической/логической проверки.

Верни ТОЛЬКО JSON:
{"answer":"полностью исправленный финальный ответ владельцу"}`;

  const repairUser = `Запрос владельца:
${args.query.slice(0, 3_500)}

Исходный ответ:
${draft}

Ошибки, найденные критиком:
${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

Доказательства/контекст:
${evidence || "Дополнительных доказательств не передано."}`;

  const repair = await callCritic({
    apiKey: args.apiKey,
    model,
    system: repairSystem,
    user: repairUser,
    maxCompletion: 1_800,
  });

  const repairedAnswer =
    typeof repair.parsed?.answer === "string" && repair.parsed.answer.trim()
      ? repair.parsed.answer.trim()
      : "";

  if (!repair.response.ok || !repair.parsed || !repairedAnswer) {
    // The review itself was valid, so Critic did run. If the repair call fails,
    // do not silently pretend the draft was verified. Return a concise warning
    // with the original answer so the owner can see what the critic found.
    const warning = `\n\n---\nПроверка Хасроя обнаружила возможную ошибку:\n${issues
      .map((issue) => `- ${issue}`)
      .join("\n")}`;

    return {
      ran: true,
      passed: false,
      revised: true,
      answer: `${args.answer}${warning}`,
      notes: issues,
      model: review.data?.model || model,
    };
  }

  return {
    ran: true,
    passed: true,
    revised: repairedAnswer !== args.answer,
    answer: repairedAnswer,
    notes: issues,
    model: repair.data?.model || review.data?.model || model,
  };
}
