import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  buildSelfRepositoryContext,
  shouldReadSelfRepository,
} from "@/lib/server-github";
import {
  appendMessage,
  buildMemoryContext,
  getRecentMessages,
  recallKnowledge,
  rememberKnowledge,
  upsertSkill,
} from "@/lib/server-memory";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `Ты — Хасрой, универсальный AI-союзник владельца системы.
Твоя главная специализация — программирование, архитектура ПО, анализ кода, исследование технологий и решение сложных технических задач.
Ты обладаешь долговременной памятью: используй сохранённый контекст, когда он действительно относится к текущему запросу, но не выдумывай воспоминания.
Когда тебе передан GITHUB SELF-REPOSITORY CONTEXT, это означает, что ты реально прочитал актуальные файлы своего репозитория через серверный GitHub-модуль. Опирайся на эти файлы, называй конкретные пути и отделяй факты из кода от предположений.
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

function explicitMemoryRequest(text: string) {
  return /(запомни|запомнить|важно|мы решили|мы договорились|хочу чтобы ты помнил|remember)/iu.test(
    text,
  );
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

  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUser) {
    return NextResponse.json({ error: "Нет пользовательского сообщения." }, { status: 400 });
  }

  let memoryContext = "";
  let memoryRead = false;
  try {
    const [recent, knowledge] = await Promise.all([
      getRecentMessages(ownerKey, 20),
      recallKnowledge(ownerKey, "", 12),
    ]);

    const current = new Set(
      messages.map((message) => `${message.role}:${message.content}`),
    );
    const olderRecent = recent.filter(
      (message) => !current.has(`${message.role}:${message.content}`),
    );
    memoryContext = buildMemoryContext(olderRecent, knowledge);
    memoryRead = true;
  } catch (error) {
    console.error("Khasroy memory read failed", error);
  }

  let repositoryContext = "";
  let repositoryRead = false;
  let repositoryCommit = "";
  let repositoryFiles: string[] = [];

  if (shouldReadSelfRepository(latestUser.content)) {
    try {
      const repository = await buildSelfRepositoryContext(latestUser.content);
      repositoryContext = repository.context;
      repositoryCommit = repository.commit;
      repositoryFiles = repository.files;
      repositoryRead = repositoryFiles.length > 0;
    } catch (error) {
      console.error("Khasroy GitHub read failed", error);
    }
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
          {
            role: "system",
            content: `${SYSTEM_PROMPT}${memoryContext}${repositoryContext}`,
          },
          ...messages.slice(-16),
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

  const memoryWrites: Promise<unknown>[] = [
    appendMessage(ownerKey, "user", latestUser.content),
    appendMessage(ownerKey, "assistant", content),
    upsertSkill(ownerKey, {
      slug: "live_ai_dialogue",
      name: "Живой AI-диалог",
      description: "Хасрой ведёт реальный диалог через подключаемый AI-мозг.",
      status: "verified",
      level: 1,
      testsPassed: 1,
      metadata: { provider: "groq", model: data.model || model },
    }),
    upsertSkill(ownerKey, {
      slug: "owner_access_control",
      name: "Контроль владельца",
      description: "Доступ к интеллекту Хасроя защищён отдельной авторизацией владельца.",
      status: "verified",
      level: 1,
      testsPassed: 1,
    }),
  ];

  if (repositoryRead) {
    memoryWrites.push(
      upsertSkill(ownerKey, {
        slug: "github_self_repository_reader",
        name: "Чтение собственного GitHub-кода",
        description: "Хасрой читает актуальное дерево и исходные файлы собственного GitHub-репозитория перед техническим ответом.",
        status: "verified",
        level: 1,
        testsPassed: 1,
        metadata: {
          repository: "akamanim/khasroy",
          branch: "main",
          commit: repositoryCommit,
          filesRead: repositoryFiles,
        },
      }),
    );
  }

  if (explicitMemoryRequest(latestUser.content)) {
    const fingerprint = createHash("sha256")
      .update(latestUser.content)
      .digest("hex")
      .slice(0, 20);
    memoryWrites.push(
      rememberKnowledge(
        ownerKey,
        `owner_${fingerprint}`,
        "owner_instruction",
        latestUser.content,
        1,
      ),
    );
  }

  const saved = await Promise.allSettled(memoryWrites);
  const memoryWrite = saved.every((result) => result.status === "fulfilled");
  if (!memoryWrite) {
    console.error("Some Khasroy memory writes failed");
  }

  return NextResponse.json({
    content,
    provider: "groq",
    model: data.model || model,
    memory: memoryRead && memoryWrite ? "active" : "error",
    github: repositoryRead ? "active" : "idle",
    githubCommit: repositoryRead ? repositoryCommit : undefined,
  });
}
