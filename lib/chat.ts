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
    return "Один короткий этап Site Agent превысил серверное время. Прогресс предыдущих этапов сохранён.";
  }
  if (siteAgent && status >= 500) return `Site Agent получил серверную ошибку HTTP ${status}.`;
  return siteAgent ? "Site Agent не смог продолжить аудит." : "Не удалось получить ответ от Хасроя.";
}

async function runSiteAgent(query: string): Promise<string> {
  const started = await fetch("/api/site-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action: "start", query, goal: query }),
  });
  if (started.status === 401) throw new KhasroyAuthError();
  const startPayload = await readApiResponse(started);
  if (!started.ok) {
    throw new Error(startPayload.data.error || fallbackHttpError(started.status, startPayload.raw, true));
  }

  const jobId = startPayload.data.jobId;
  if (!jobId) throw new Error("Site Agent не получил jobId.");

  let retryAfterMs = startPayload.data.retryAfterMs || 100;
  const deadline = Date.now() + 10 * 60 * 1000;
  let attempts = 0;

  while (Date.now() < deadline && attempts < 180) {
    attempts += 1;
    if (retryAfterMs > 0) await wait(retryAfterMs);

    const response = await fetch("/api/site-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "step", jobId }),
    });
    if (response.status === 401) throw new KhasroyAuthError();
    const payload = await readApiResponse(response);

    if (!response.ok) {
      if (payload.data.retryable) {
        retryAfterMs = payload.data.retryAfterMs || 2500;
        continue;
      }
      throw new Error(payload.data.error || fallbackHttpError(response.status, payload.raw, true));
    }

    if (payload.data.done) {
      if (typeof payload.data.content !== "string" || !payload.data.content.trim()) {
        throw new Error("Site Agent завершил job без итогового отчёта.");
      }
      return payload.data.content.trim();
    }

    retryAfterMs = payload.data.retryAfterMs || 150;
  }

  throw new Error("Site Agent не успел завершить job за 10 минут. Прогресс сохранён на сервере.");
}

export async function chat(messages: Message[]): Promise<string> {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const siteAgent = latestUser ? looksLikeSiteAgentRequest(latestUser.content) : false;
  if (siteAgent && latestUser) return runSiteAgent(latestUser.content);

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
  return payload.data.content.trim();
}
