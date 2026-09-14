import {
  detectImageGenerationIntent,
  looksLikeImageGenerationRequest,
} from "@/lib/image-intent";

export { looksLikeImageGenerationRequest } from "@/lib/image-intent";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatApiResponse = {
  content?: string;
  error?: string;
  jobId?: string;
  stage?: string;
  done?: boolean;
  progress?: string;
  retryAfterMs?: number;
  retryable?: boolean;
  image?: string;
  model?: string;
  lab?: string;
  mode?: string;
  execution?: string;
  prompt?: string;
  confidence?: string;
  failureClass?: "technical" | "semantic";
  code?: string;
  detail?: string;
  attempts?: number;
};

export type ChatProgress = {
  stage?: string;
  message: string;
};

export type ChatCallbacks = {
  onProgress?: (progress: ChatProgress) => void;
  onChunk?: (delta: string, full: string) => void;
};

export class KhasroyAuthError extends Error {
  constructor() {
    super("Требуется доступ владельца.");
    this.name = "KhasroyAuthError";
  }
}

export async function authenticateOwner(key: string): Promise<boolean> {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ key }),
  });
  return response.ok;
}

function looksLikeSiteAgentRequest(text: string) {
  const hasUrl = /https?:\/\/[^\s]+/iu.test(text) || /\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/iu.test(text);
  const hasIntent = /(аудит|проанализ|проверь|улучш|передел|редизайн|сделай.*лучше|оцени|audit|redesign|improve|review)/iu.test(text);
  return hasUrl && hasIntent;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(ms, 70000))));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readApiResponse(response: Response): Promise<{ raw: string; data: ChatApiResponse }> {
  const raw = await response.text().catch(() => "");
  if (!raw) return { raw: "", data: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    return { raw, data: parsed && typeof parsed === "object" ? parsed as ChatApiResponse : {} };
  } catch {
    return { raw, data: {} };
  }
}

function fallbackHttpError(status: number, raw: string, siteAgent: boolean) {
  if (siteAgent && (status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed?\s*out|timeout/iu.test(raw))) {
    return "Один этап Site Agent временно не ответил. Job сохранён и может продолжиться с того же этапа.";
  }
  if (siteAgent && status >= 500) return `Site Agent получил серверную ошибку HTTP ${status}.`;
  return siteAgent ? "Site Agent не смог продолжить аудит." : "Не удалось получить ответ от Хасроя.";
}

function shouldRetryTransport(status: number, raw: string) {
  return status === 408 || status === 502 || status === 503 || status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed?\s*out|timeout/iu.test(raw);
}

function typewriterPlan(remaining: number) {
  if (remaining > 1600) return { size: 5, delay: 8 + Math.random() * 4 };
  if (remaining > 700) return { size: 3, delay: 10 + Math.random() * 6 };
  if (remaining > 220) return { size: 2, delay: 14 + Math.random() * 8 };
  return { size: 1, delay: 24 + Math.random() * 14 };
}

function typewriterPause(delta: string) {
  const last = Array.from(delta).at(-1) || "";
  if (/[.!?…]/u.test(last)) return 90;
  if (/[,;:]/u.test(last)) return 42;
  if (last === "\n") return 58;
  return 0;
}

async function revealContent(content: string, callbacks?: ChatCallbacks) {
  if (!callbacks?.onChunk) return;

  const characters = Array.from(content);
  let cursor = 0;
  let full = "";

  while (cursor < characters.length) {
    const remaining = characters.length - cursor;
    const plan = typewriterPlan(remaining);
    const delta = characters.slice(cursor, cursor + plan.size).join("");

    cursor += plan.size;
    full += delta;
    callbacks.onChunk(delta, full);

    await wait(plan.delay + typewriterPause(delta));
  }
}

function emitProgress(callbacks: ChatCallbacks | undefined, data: ChatApiResponse, fallback?: string) {
  const message = typeof data.progress === "string" && data.progress.trim() ? data.progress.trim() : fallback;
  if (message) callbacks?.onProgress?.({ stage: data.stage, message });
}

async function resolveImageExecutorIntent(text: string) {
  const local = detectImageGenerationIntent(text);
  if (local) return local;

  try {
    const response = await fetchWithTimeout(
      "/api/image-intent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      },
      4_000,
    );
    if (response.status === 401) throw new KhasroyAuthError();
    if (!response.ok) return null;
    const payload = await readApiResponse(response);
    if (payload.data.execution === "image_generation" && typeof payload.data.prompt === "string") {
      const prompt = payload.data.prompt.trim();
      if (!prompt) return null;
      return {
        kind: "image_generation" as const,
        prompt,
        confidence: payload.data.confidence === "explicit" ? "explicit" as const : "visual_scene" as const,
      };
    }
  } catch (error) {
    if (error instanceof KhasroyAuthError) throw error;
    console.warn("Khasroy Executor Gate unavailable; continuing with normal router", error);
  }
  return null;
}

function imageMarkdown(data: ChatApiResponse, callbacks?: ChatCallbacks) {
  const image = typeof data.image === "string" ? data.image.trim() : "";
  if (!image || !/^data:image\/(?:png|jpeg|jpg|webp);base64,/iu.test(image)) return null;

  const model = typeof data.model === "string" && data.model.trim()
    ? data.model.trim()
    : "Image Runtime";
  const attempts = typeof data.attempts === "number" ? data.attempts : 1;
  const content = `Готово${attempts > 1 ? ` — понадобилось ${attempts} попытки` : ""}. Я проверил изображение перед показом.\n\n![Сгенерированное изображение](${image})\n\n*Модель: ${model}*`;

  callbacks?.onProgress?.({
    stage: "IMAGE_DONE",
    message: "Готово. Изображение прошло проверку.",
  });
  callbacks?.onChunk?.(content, content);
  return content;
}

function imageFailure(content: string, callbacks?: ChatCallbacks) {
  callbacks?.onProgress?.({
    stage: "IMAGE_WAITING",
    message: "Генерацию завершить не удалось. Объясняю без технического мусора…",
  });
  callbacks?.onChunk?.(content, content);
  return content;
}

async function runImageGeneration(query: string, callbacks?: ChatCallbacks): Promise<string> {
  callbacks?.onProgress?.({
    stage: "IMAGE",
    message: "Понял: это запрос на изображение. Создаю и проверяю результат…",
  });

  let primaryData: ChatApiResponse = {};
  let primaryStatus = 0;
  try {
    const response = await fetchWithTimeout(
      "/api/image-executor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: query }),
      },
      70_000,
    );
    if (response.status === 401) throw new KhasroyAuthError();
    primaryStatus = response.status;
    const payload = await readApiResponse(response);
    primaryData = payload.data;
    if (response.ok) {
      const rendered = imageMarkdown(payload.data, callbacks);
      if (rendered) return rendered;
    }
  } catch (error) {
    if (error instanceof KhasroyAuthError) throw error;
    console.warn("Primary Khasroy image executor failed", error);
  }

  callbacks?.onProgress?.({
    stage: "IMAGE_FALLBACK",
    message: "Первый генератор не завершил задачу. Переключаюсь на резервный способ…",
  });

  let fallbackData: ChatApiResponse = {};
  let fallbackStatus = 0;
  try {
    const response = await fetchWithTimeout(
      "/api/image-lab",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: query, fast: true }),
      },
      70_000,
    );
    if (response.status === 401) throw new KhasroyAuthError();
    fallbackStatus = response.status;
    const payload = await readApiResponse(response);
    fallbackData = payload.data;
    if (response.ok) {
      const rendered = imageMarkdown(payload.data, callbacks);
      if (rendered) return rendered;
    }
  } catch (error) {
    if (error instanceof KhasroyAuthError) throw error;
    console.warn("Fallback Khasroy image lab failed", error);
  }

  const semanticFailure =
    primaryData.failureClass === "semantic" ||
    fallbackData.failureClass === "semantic" ||
    primaryStatus === 422 ||
    fallbackStatus === 422;

  if (semanticFailure) {
    return imageFailure(
      "Я попробовал два способа генерации, но результат не прошёл мою визуальную проверку. Я не буду показывать плохую картинку. Уточни сцену одним сообщением — я попробую снова.",
      callbacks,
    );
  }

  return imageFailure(
    "Сейчас генераторы не смогли завершить изображение. Я уже автоматически переключился с основного на резервный способ. Код и навык не сломаны — внешний генератор временно не дал пригодный результат. Попробуй ещё раз через минуту.",
    callbacks,
  );
}

function looksLikeImageCapabilityRefusal(content: string) {
  return /(не могу|не умею|невозможно).{0,80}(создава|сгенерир|генерир|изображ|картин|фото)|cannot.{0,80}(create|generate).{0,40}(image|photo|picture)/iu.test(content);
}

function latentVisualRequest(text: string) {
  return /(сгенерир|генерир|нарис|визуализир|изобраз|фото|фотк|картин|изображ|портрет|логотип|за рул[её]м|рядом с|на фоне)/iu.test(text);
}

async function runSiteAgent(query: string, callbacks?: ChatCallbacks): Promise<string> {
  callbacks?.onProgress?.({ stage: "START", message: "Подготавливаю Site Agent и создаю resumable job…" });
  const started = await fetchWithTimeout(
    "/api/site-agent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "start", query, goal: query }),
    },
    30_000,
  );
  if (started.status === 401) throw new KhasroyAuthError();
  const startPayload = await readApiResponse(started);
  if (!started.ok) {
    throw new Error(startPayload.data.error || fallbackHttpError(started.status, startPayload.raw, true));
  }

  const jobId = startPayload.data.jobId;
  if (!jobId) throw new Error("Site Agent не получил jobId.");
  emitProgress(callbacks, startPayload.data, "Job создан. Начинаю исследование сайта.");

  let retryAfterMs = startPayload.data.retryAfterMs || 100;
  const deadline = Date.now() + 20 * 60 * 1000;
  let attempts = 0;
  let consecutiveTransportFailures = 0;

  while (Date.now() < deadline && attempts < 320) {
    attempts += 1;
    if (retryAfterMs > 0) await wait(retryAfterMs);

    let response: Response;
    try {
      response = await fetchWithTimeout(
        "/api/site-agent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "step", jobId }),
        },
        45_000,
      );
    } catch (error) {
      if (error instanceof KhasroyAuthError) throw error;
      consecutiveTransportFailures += 1;
      callbacks?.onProgress?.({ stage: "RETRY", message: `Связь с этапом прервалась. Повторяю только текущий шаг (${consecutiveTransportFailures}/12)…` });
      if (consecutiveTransportFailures > 12) {
        throw new Error("Site Agent слишком много раз подряд потерял связь с сервером. Job сохранён; повторный запуск можно продолжить позже.");
      }
      retryAfterMs = Math.min(2500 + consecutiveTransportFailures * 1000, 15_000);
      continue;
    }

    if (response.status === 401) throw new KhasroyAuthError();
    const payload = await readApiResponse(response);

    if (!response.ok) {
      if (payload.data.retryable || shouldRetryTransport(response.status, payload.raw)) {
        consecutiveTransportFailures += 1;
        callbacks?.onProgress?.({ stage: payload.data.stage || "RETRY", message: payload.data.error || "Внешний сервис не ответил вовремя. Повторяю текущий этап без потери прогресса…" });
        retryAfterMs = payload.data.retryAfterMs || Math.min(2500 + consecutiveTransportFailures * 1000, 15_000);
        continue;
      }
      throw new Error(payload.data.error || fallbackHttpError(response.status, payload.raw, true));
    }

    consecutiveTransportFailures = 0;
    emitProgress(callbacks, payload.data);

    if (payload.data.done) {
      if (typeof payload.data.content !== "string" || !payload.data.content.trim()) {
        throw new Error("Site Agent завершил job без итогового отчёта.");
      }
      const content = payload.data.content.trim();
      callbacks?.onProgress?.({ stage: "DONE", message: "Анализ завершён. Формирую итоговый отчёт по частям…" });
      await revealContent(content, callbacks);
      return content;
    }

    retryAfterMs = payload.data.retryAfterMs || 150;
  }

  throw new Error("Site Agent не успел завершить job за 20 минут. Прогресс сохранён на сервере.");
}

export async function chat(messages: Message[], callbacks?: ChatCallbacks): Promise<string> {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  if (latestUser) {
    const imageIntent = await resolveImageExecutorIntent(latestUser.content);
    if (imageIntent) return runImageGeneration(imageIntent.prompt, callbacks);
  }

  const siteAgent = latestUser ? looksLikeSiteAgentRequest(latestUser.content) : false;
  if (siteAgent && latestUser) return runSiteAgent(latestUser.content, callbacks);

  callbacks?.onProgress?.({ stage: "BRAIN", message: "думаю..." });
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
  });

  if (response.status === 401) throw new KhasroyAuthError();
  const payload = await readApiResponse(response);
  if (!response.ok) {
    throw new Error(payload.data.error || fallbackHttpError(response.status, payload.raw, false));
  }
  if (typeof payload.data.content !== "string" || !payload.data.content.trim()) {
    throw new Error("Хасрой вернул пустой ответ.");
  }
  const content = payload.data.content.trim();

  // Safety net: a text model must never end an image request with the old
  // "I cannot create images" boilerplate. If one slips through, reroute it.
  if (
    latestUser &&
    looksLikeImageCapabilityRefusal(content) &&
    (looksLikeImageGenerationRequest(latestUser.content) || latentVisualRequest(latestUser.content))
  ) {
    callbacks?.onProgress?.({
      stage: "IMAGE_REROUTE",
      message: "Текстовый мозг выбрал неверный путь. Исправляю маршрут и запускаю генерацию…",
    });
    return runImageGeneration(latestUser.content, callbacks);
  }

  callbacks?.onProgress?.({ stage: "RESPONSE", message: "Ответ готов. Показываю его постепенно…" });
  await revealContent(content, callbacks);
  return content;
}
