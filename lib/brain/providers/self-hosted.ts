export type SelfHostedMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type SelfHostedResponseData = {
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

export type SelfHostedConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function getSelfHostedConfig(): SelfHostedConfig | null {
  const baseUrl = process.env.KHASROY_SELF_HOSTED_BASE_URL?.trim();
  const model = process.env.KHASROY_SELF_HOSTED_MODEL?.trim();
  if (!baseUrl || !model) return null;

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: process.env.KHASROY_SELF_HOSTED_API_KEY?.trim() || undefined,
    model,
  };
}

export function hasSelfHostedBrain() {
  return getSelfHostedConfig() !== null;
}

export async function selfHostedChat(args: {
  messages: SelfHostedMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const config = getSelfHostedConfig();
  if (!config) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: args.messages,
        max_tokens: args.maxTokens ?? 1800,
        temperature: args.temperature ?? 0.25,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    const data = (await response.json().catch(() => null)) as SelfHostedResponseData | null;
    return { response, data, model: data?.model || config.model };
  } catch (error) {
    console.error("Khasroy self-hosted brain request failed", error);
    return null;
  }
}

export async function selfHostedHealth() {
  const config = getSelfHostedConfig();
  if (!config) return { configured: false, online: false, model: null as string | null };

  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    return {
      configured: true,
      online: response.ok,
      model: config.model,
    };
  } catch {
    return {
      configured: true,
      online: false,
      model: config.model,
    };
  }
}
