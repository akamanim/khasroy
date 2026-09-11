export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatApiResponse = {
  content?: string;
  error?: string;
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

function fallbackHttpError(status: number, raw: string, siteAgent: boolean) {
  if (siteAgent && (status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed?\s*out|timeout/iu.test(raw))) {
    return "Site Agent превысил серверное время выполнения. Это системный таймаут Vercel, а не ошибка аудита.";
  }
  if (siteAgent && status >= 500) {
    return `Site Agent завершился серверной ошибкой HTTP ${status}. Конкретный stage-error не дошёл до браузера.`;
  }
  return siteAgent
    ? "Site Agent не смог завершить аудит. Попробуйте ещё раз чуть позже."
    : "Не удалось получить ответ от Хасроя.";
}

export async function chat(messages: Message[]): Promise<string> {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const siteAgent = latestUser ? looksLikeSiteAgentRequest(latestUser.content) : false;
  const response = await fetch(siteAgent ? "/api/site-agent" : "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(
      siteAgent
        ? { query: latestUser?.content || "", goal: latestUser?.content || "" }
        : { messages: messages.map(({ role, content }) => ({ role, content })) },
    ),
  });

  if (response.status === 401) throw new KhasroyAuthError();

  const raw = await response.text().catch(() => "");
  let data: ChatApiResponse = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") data = parsed as ChatApiResponse;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" && data.error.trim()
        ? data.error
        : fallbackHttpError(response.status, raw, siteAgent),
    );
  }

  if (typeof data.content !== "string" || !data.content.trim()) {
    throw new Error("Хасрой вернул пустой ответ.");
  }

  return data.content.trim();
}
