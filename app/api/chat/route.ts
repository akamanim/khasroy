import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  buildSelfRepositoryContext,
  shouldReadSelfRepository,
} from "@/lib/server-github";
import {
  runBrain,
  selectBrainMode,
  usedCodeInterpreter,
  usedWebTool,
  type BrainRun,
} from "@/lib/brain/router";
import { runCritic, shouldRunCritic, type CriticMode } from "@/lib/brain/critic";
import {
  appendMessage,
  buildMemoryContext,
  getRecentMessages,
  queueTask,
  recallKnowledge,
  rememberKnowledge,
  upsertSkill,
} from "@/lib/server-memory";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMERGENCY_CHAT_GATEWAY =
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-chat-live";

const SYSTEM_PROMPT = `Ты — Хасрой, универсальный AI-союзник владельца системы.
Твоя главная специализация — программирование, архитектура ПО, анализ кода, исследование технологий и решение сложных технических задач.
Ты обладаешь долговременной памятью: используй сохранённый контекст, когда он действительно относится к текущему запросу, но не выдумывай воспоминания.
Когда тебе передан GITHUB SELF-REPOSITORY CONTEXT, это означает, что сервер реально загрузил актуальные файлы твоего репозитория. Опирайся на них, называй конкретные пути и отделяй факты из кода от предположений.
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

type EmergencyChatResponse = {
  content?: string;
  model?: string;
  error?: string;
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

function criticEvidence(args: {
  repositoryRead: boolean;
  repositoryContext: string;
  sources: Array<{ title: string; url: string }>;
  toolsUsed: string[];
}) {
  if (args.repositoryRead) return args.repositoryContext.slice(0, 5_000);
  const sourceText = args.sources.length
    ? args.sources.map((source) => `${source.title} — ${source.url}`).join("\n")
    : "";
  const toolText = args.toolsUsed.length ? `\nTools: ${args.toolsUsed.join(", ")}` : "";
  return `${sourceText}${toolText}`.trim();
}

async function runEmergencyChat(args: {
  ownerKey: string;
  query: string;
  history: ClientMessage[];
}): Promise<BrainRun | null> {
  const endpoint =
    process.env.KHASROY_EMERGENCY_CHAT_GATEWAY?.trim() || EMERGENCY_CHAT_GATEWAY;
  const ownerHash = createHash("sha256").update(args.ownerKey).digest("hex");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `khasroy_live_owner=${encodeURIComponent(ownerHash)}`,
      },
      body: JSON.stringify({
        action: "chat",
        message: args.query,
        history: args.history.slice(-8),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });

    const payload = (await response.json().catch(() => null)) as
      | EmergencyChatResponse
      | null;
    const content = payload?.content?.trim() || "";

    if (!response.ok || !content) {
      console.error(
        "Khasroy emergency brain failed",
        response.status,
        payload?.error || "empty_response",
      );
      return null;
    }

    const model = payload?.model?.trim() || "openai-emergency";
    const data: NonNullable<BrainRun["data"]> = {
      model,
      choices: [{ message: { content } }],
    };
    const normalized = new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-khasroy-ai-provider": "gateway",
      },
    });

    return {
      response: normalized,
      data,
      provider: "groq",
      providerDetail: "gateway",
      model,
      mode: "chat",
      toolsUsed: [],
      sources: [],
      webToolForced: false,
    };
  } catch (error) {
    console.error("Khasroy emergency brain request failed", error);
    return null;
  }
}

async function queueForRecovery(args: {
  ownerKey: string;
  query: string;
  history: ClientMessage[];
  mode: string;
  reason: string;
  status?: number;
}) {
  const safeMode = args.mode || "chat";
  try {
    const task = await queueTask(args.ownerKey, {
      kind: safeMode,
      priority: safeMode === "chat" ? 70 : 60,
      input: {
        query: args.query,
        history: args.history.slice(-12),
      },
      checkpoint: {
        stage: "waiting_for_compute",
        reason: args.reason.slice(0, 240),
        upstreamStatus: args.status || null,
        queuedAt: new Date().toISOString(),
      },
    });

    const content = task?.id
      ? `Я сохранил задачу в устойчивую очередь. Сейчас внешний вычислительный ресурс недоступен, но запрос не потерян. Идентификатор задачи: ${task.id}.`
      : "Я сохранил задачу в устойчивую очередь. Сейчас внешний вычислительный ресурс недоступен, но запрос не потерян.";

    await Promise.allSettled([
      appendMessage(args.ownerKey, "user", args.query),
      appendMessage(args.ownerKey, "assistant", content),
    ]);

    return NextResponse.json(
      {
        content,
        provider: "survival-core",
        model: "queued",
        brainMode: safeMode,
        memory: "active",
        queued: true,
        taskId: task?.id || undefined,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Khasroy survival queue failed", error);
    return NextResponse.json(
      {
        content:
          "Внешний AI сейчас недоступен. Я остаюсь активен, но не смог надёжно сохранить эту задачу в очередь, поэтому лучше повторить запрос позже.",
        provider: "survival-core",
        model: "degraded",
        brainMode: safeMode,
        memory: "error",
        queued: false,
      },
      { status: 200 },
    );
  }
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

  const apiKey = process.env.GROQ_API_KEY?.trim() || "";

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

  const defaultModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  const memoryForBrain = repositoryRead ? memoryContext.slice(0, 5_000) : memoryContext;
  const systemContent = `${SYSTEM_PROMPT}${memoryForBrain}${repositoryContext}`;
  const intendedMode = selectBrainMode(latestUser.content, repositoryRead);

  let brain: Awaited<ReturnType<typeof runBrain>>;
  try {
    brain = await runBrain({
      apiKey,
      defaultModel,
      systemContent,
      history: messages,
      query: latestUser.content,
      repositoryRead,
    });
  } catch (error) {
    console.error("Khasroy Brain Router failed", error);
    const emergency =
      intendedMode === "chat"
        ? await runEmergencyChat({ ownerKey, query: latestUser.content, history: messages })
        : null;
    if (!emergency) {
      return queueForRecovery({
        ownerKey,
        query: latestUser.content,
        history: messages,
        mode: intendedMode,
        reason: error instanceof Error ? error.message : "brain_router_exception",
      });
    }
    brain = emergency;
  }

  let upstream = brain.response;
  let data = brain.data;

  if ((!upstream.ok || !data) && brain.mode === "chat") {
    const emergency = await runEmergencyChat({
      ownerKey,
      query: latestUser.content,
      history: messages,
    });
    if (emergency) {
      brain = emergency;
      upstream = emergency.response;
      data = emergency.data;
    }
  }

  if (!upstream.ok || !data) {
    console.error(
      "Brain API error",
      brain.mode,
      upstream.status,
      data?.error?.type,
      data?.error?.code,
    );

    return queueForRecovery({
      ownerKey,
      query: latestUser.content,
      history: messages,
      mode: brain.mode,
      reason: data?.error?.code || data?.error?.type || "provider_unavailable",
      status: upstream.status,
    });
  }

  const draftContent = data.choices?.[0]?.message?.content?.trim();
  if (!draftContent) {
    return queueForRecovery({
      ownerKey,
      query: latestUser.content,
      history: messages,
      mode: brain.mode,
      reason: "empty_ai_response",
      status: upstream.status,
    });
  }

  const emergencyProvider = brain.providerDetail === "gateway" && /emergency/iu.test(brain.model);
  let content = draftContent;
  let criticRan = false;
  let criticRevised = false;
  let criticNotes: string[] = [];
  let criticModel: string | undefined;

  if (apiKey && !emergencyProvider && shouldRunCritic(latestUser.content, brain.mode, draftContent)) {
    try {
      const critic = await runCritic({
        apiKey,
        query: latestUser.content,
        answer: draftContent,
        mode: (brain.mode === "chat" ? "technical" : brain.mode) as CriticMode,
        evidence: criticEvidence({
          repositoryRead,
          repositoryContext,
          sources: brain.sources,
          toolsUsed: brain.toolsUsed,
        }),
      });
      criticRan = critic.ran;
      criticRevised = critic.revised;
      criticNotes = critic.notes;
      criticModel = critic.model;
      if (critic.ran && critic.answer.trim()) content = critic.answer.trim();
    } catch (error) {
      console.error("Khasroy critic failed", error);
    }
  }

  const webVerified = usedWebTool(brain);
  const sandboxVerified = usedCodeInterpreter(brain);
  const providerLabel = emergencyProvider
    ? "supabase-pollinations"
    : brain.providerDetail || brain.provider;

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
      metadata: { provider: providerLabel, model: brain.model },
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

  if (webVerified) {
    memoryWrites.push(
      upsertSkill(ownerKey, {
        slug: "internet_research",
        name: "Интернет-исследование",
        description: "Хасрой использует реальный веб-поиск или посещение сайта и отвечает на основе найденных источников.",
        status: "verified",
        level: 1,
        testsPassed: 1,
        metadata: {
          provider: providerLabel,
          model: brain.model,
          sources: brain.sources,
        },
      }),
    );
  }

  if (sandboxVerified) {
    memoryWrites.push(
      upsertSkill(ownerKey, {
        slug: "cloud_code_sandbox",
        name: "Облачная песочница кода",
        description: "Хасрой может запускать Python/Node.js-код в изолированной облачной среде для вычислений и проверки решений.",
        status: "verified",
        level: 1,
        testsPassed: 1,
        metadata: {
          provider: providerLabel,
          model: brain.model,
          environment: brain.toolsUsed.some((tool) => /vercel_sandbox/iu.test(tool))
            ? "vercel_sandbox_firecracker"
            : "groq_compound_code_interpreter",
          toolsUsed: brain.toolsUsed,
        },
      }),
    );
  }

  if (criticRan) {
    memoryWrites.push(
      upsertSkill(ownerKey, {
        slug: "independent_response_critic",
        name: "Независимая проверка ответа",
        description: "Хасрой пропускает технические ответы через отдельный критический проход и при необходимости исправляет их перед показом владельцу.",
        status: "verified",
        level: 1,
        testsPassed: 1,
        metadata: {
          model: criticModel,
          revised: criticRevised,
          notes: criticNotes,
          checkedMode: brain.mode,
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
    provider: providerLabel,
    model: brain.model,
    brainMode: brain.mode,
    memory: memoryRead && memoryWrite ? "active" : "error",
    github: repositoryRead ? "active" : "idle",
    githubCommit: repositoryRead ? repositoryCommit : undefined,
    githubFiles: repositoryRead ? repositoryFiles : undefined,
    internet: webVerified ? "verified" : "idle",
    sandbox: sandboxVerified ? "verified" : "idle",
    critic: criticRan
      ? { status: "verified", revised: criticRevised, notes: criticNotes }
      : { status: "idle" },
    sources: webVerified ? brain.sources : undefined,
  });
}
