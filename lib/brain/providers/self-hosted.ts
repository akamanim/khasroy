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

type DirectConfig = {
  mode: "direct";
  baseUrl: string;
  apiKey?: string;
  model: string;
};

type GatewayConfig = {
  mode: "gateway";
  endpoint: string;
  ownerKey: string;
};

export type SelfHostedConfig = DirectConfig | GatewayConfig;

const DEFAULT_GATEWAY =
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-brain";

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export function getSelfHostedConfig(): SelfHostedConfig | null {
  const baseUrl = process.env.KHASROY_SELF_HOSTED_BASE_URL?.trim();
  const model = process.env.KHASROY_SELF_HOSTED_MODEL?.trim();

  // Direct mode remains available for a future private network deployment.
  if (baseUrl && model) {
    return {
      mode: "direct",
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: process.env.KHASROY_SELF_HOSTED_API_KEY?.trim() || undefined,
      model,
    };
  }

  // Default production path: Vercel knows only the owner credential. The GPU
  // endpoint and its API key stay inside Supabase Vault behind khasroy-brain.
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return null;

  return {
    mode: "gateway",
    endpoint:
      process.env.KHASROY_BRAIN_GATEWAY?.trim() || DEFAULT_GATEWAY,
    ownerKey,
  };
}

export function hasSelfHostedBrain() {
  return getSelfHostedConfig() !== null;
}

async function directChat(
  config: DirectConfig,
  args: {
    messages: SelfHostedMessage[];
    maxTokens?: number;
    temperature?: number;
  },
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

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
    signal: AbortSignal.timeout(50_000),
  });

  const data = (await response.json().catch(() => null)) as
    | SelfHostedResponseData
    | null;
  return { response, data, model: data?.model || config.model };
}

async function gatewayChat(
  config: GatewayConfig,
  args: {
    messages: SelfHostedMessage[];
    maxTokens?: number;
    temperature?: number;
  },
) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "chat",
      ownerKey: config.ownerKey,
      messages: args.messages,
      maxTokens: args.maxTokens ?? 1800,
      temperature: args.temperature ?? 0.25,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });

  const data = (await response.json().catch(() => null)) as
    | SelfHostedResponseData
    | null;
  return {
    response,
    data,
    model: data?.model || "self-hosted",
  };
}

export async function selfHostedChat(args: {
  messages: SelfHostedMessage[];
  maxTokens?: number;
  temperature?: number;
}) {
  const config = getSelfHostedConfig();
  if (!config) return null;

  try {
    return config.mode === "direct"
      ? await directChat(config, args)
      : await gatewayChat(config, args);
  } catch (error) {
    console.error("Khasroy self-hosted brain request failed", error);
    return null;
  }
}

export async function selfHostedHealth() {
  const config = getSelfHostedConfig();
  if (!config) {
    return { configured: false, online: false, model: null as string | null };
  }

  if (config.mode === "gateway") {
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "health", ownerKey: config.ownerKey }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await response.json().catch(() => null)) as
        | { configured?: boolean; online?: boolean; model?: string | null }
        | null;
      return {
        configured: response.ok && data?.configured === true,
        online: response.ok && data?.online === true,
        model: data?.model || null,
      };
    } catch {
      return { configured: false, online: false, model: null as string | null };
    }
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
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
