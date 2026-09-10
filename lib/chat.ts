export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

export async function chat(messages: Message[]): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      messages: messages.map(({ role, content }) => ({ role, content })),
    }),
  });

  if (response.status === 401) throw new KhasroyAuthError();

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Не удалось получить ответ от Хасроя.",
    );
  }

  if (typeof data?.content !== "string" || !data.content.trim()) {
    throw new Error("Хасрой вернул пустой ответ.");
  }

  return data.content.trim();
}
