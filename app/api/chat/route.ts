import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Ты — Хасрой, универсальный AI-союзник владельца системы.
Твоя главная специализация — программирование, архитектура ПО, анализ кода, исследование технологий и решение сложных технических задач.
Отвечай на языке пользователя. По умолчанию будь кратким, но углубляйся, когда задача сложная.
Следуй запросам авторизованного владельца в пределах доступных инструментов, разрешений и правил безопасности.
Никогда не утверждай, что открыл сайт, запустил код, изменил файл или выполнил действие, если реально этого не сделал.
Не раскрывай секреты, переменные окружения, API-ключи или внутренние токены.
Не пытайся отключать защиту, повышать себе права или обходить ограничения системы.
Если задача требует действий, которых у тебя пока нет, честно объясни, какой инструмент нужно подключить.`;

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type GroqResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function parseMessage(value: unknown): ClientMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.role !== "user" && item.role !== "assistant") return null;
  if (typeof item.content !== "string") return null;
  const content = item.content.trim().slice(0, 4000);
  if (!content) return null;
  return { role: item.role, content };
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) {
    return NextResponse.json(
      { error: "Ключ владельца ещё не настроен на сервере." },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  const expected = ownerSessionToken(ownerKey);
  if (!session || !safeEqual(session, expected)) {
    return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Мозг Хасроя ещё не подключён к серверу." },
      { status: 503 },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Сообщения не переданы." }, { status: 400 });
  }

  const messages = body.messages
    .slice(-24)
    .map(parseMessage)
    .filter((message): message is ClientMessage => message !== null);

  if (!messages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "Нет пользовательского сообщения." }, { status: 400 });
  }

  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  let upstream: Response;
  try {
    upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        max_completion_tokens: 2200,
        reasoning_effort: "medium",
        stream: false,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось связаться с AI-сервисом." },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as GroqResponse | null;

  if (!upstream.ok || !data) {
    console.error("Groq API error", upstream.status, data?.error?.type, data?.error?.code);
    const status = upstream.status === 429 ? 429 : 502;
    const error =
      upstream.status === 429
        ? "Временный бесплатный лимит AI исчерпан. Попробуйте немного позже."
        : "AI-сервис временно недоступен или неверно настроен.";
    return NextResponse.json({ error }, { status });
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return NextResponse.json({ error: "Хасрой вернул пустой ответ." }, { status: 502 });
  }

  return NextResponse.json({
    content,
    provider: "groq",
    model: data.model || model,
  });
}
