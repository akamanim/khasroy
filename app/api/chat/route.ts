import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Ты — Хасрой, универсальный AI-союзник владельца системы.
Твоя главная специализация — программирование, архитектура ПО, анализ кода, исследование технологий и решение сложных технических задач.
Отвечай на языке пользователя. По умолчанию будь кратким, но углубляйся, когда задача сложная.
Следуй запросам авторизованного владельца в пределах доступных тебе инструментов, разрешений и правил безопасности.
Никогда не утверждай, что открыл сайт, запустил код, изменил файл или выполнил действие, если реально этого не сделал.
Не раскрывай секреты, переменные окружения, API-ключи или внутренние токены.
Не пытайся отключать защиту, повышать себе права или обходить ограничения системы.
Если задача требует действий, которых у тебя пока нет, честно объясни, какой инструмент нужно подключить.`;

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

function extractText(data: any): string {
  const parts = Array.isArray(data?.output) ? data.output : [];
  const text = parts
    .flatMap((item: any) => (item?.type === "message" && Array.isArray(item.content) ? item.content : []))
    .filter((part: any) => part?.type === "output_text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("")
    .trim();

  if (text) return text;

  const refusal = parts
    .flatMap((item: any) => (item?.type === "message" && Array.isArray(item.content) ? item.content : []))
    .find((part: any) => part?.type === "refusal" && typeof part.refusal === "string");

  return refusal?.refusal?.trim?.() || "Хасрой не смог сформировать текстовый ответ.";
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) {
    return NextResponse.json(
      { error: "KHASROY_OWNER_KEY не настроен на сервере." },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  const expected = ownerSessionToken(ownerKey);
  if (!session || !safeEqual(session, expected)) {
    return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY не настроен на сервере." },
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

  const messages: ClientMessage[] = body.messages
    .slice(-24)
    .filter(
      (item: any) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .map((item: any) => ({
      role: item.role,
      content: item.content.trim().slice(0, 4000),
    }))
    .filter((item: ClientMessage) => item.content.length > 0);

  if (!messages.some((message) => message.role === "user")) {
    return NextResponse.json({ error: "Нет пользовательского сообщения." }, { status: 400 });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: messages,
      max_output_tokens: 2200,
      store: false,
    }),
  });

  let data: any = null;
  try {
    data = await upstream.json();
  } catch {
    return NextResponse.json({ error: "AI-сервис вернул некорректный ответ." }, { status: 502 });
  }

  if (!upstream.ok) {
    console.error("OpenAI API error", data?.error?.type, data?.error?.code);
    return NextResponse.json(
      { error: "AI-сервис временно недоступен или неверно настроен." },
      { status: 502 },
    );
  }

  return NextResponse.json({ content: extractText(data), model });
}
