import {
  canAttemptProvider,
  providerHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
} from "./survival/provider-health.ts";
import {
  hydratePersistentProviderHealth,
  persistProviderFailure,
  persistProviderSuccess,
} from "./survival/persistent-provider-health.ts";

export type SiteAgentProvider = "groq" | "openai";

export type ProviderMessage = {
  role: "system" | "user";
  content: string | Array<Record<string, unknown>>;
};

export type JsonProviderRequest = {
  messages: ProviderMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  groqApiKey?: string;
  openaiApiKey?: string;
};

type ProviderConfig = {
  provider: SiteAgentProvider;
  apiKey: string;
  endpoint: string;
  model: string;
};

type RuntimeHealth = {
  available?: boolean;
  successes?: number;
  failures?: number;
  consecutiveFailures?: number;
  averageLatencyMs?: number | null;
};

const DEFAULT_TIMEOUT_MS = 25_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const PROVIDER_PRIORITY: Record<SiteAgentProvider, number> = { groq: 96, openai: 92 };

function providers(groqApiKey?: string, openaiApiKey?: string): ProviderConfig[] {
  const result: ProviderConfig[] = [];
  const groqKey = groqApiKey || process.env.GROQ_API_KEY;
  const openaiKey = openaiApiKey || process.env.OPENAI_API_KEY;
  if (groqKey) result.push({
    provider: "groq",
    apiKey: groqKey,
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_VISION_MODEL || "qwen/qwen3.6-27b",
  });
  if (openaiKey) result.push({
    provider: "openai",
    apiKey: openaiKey,
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_SITE_AGENT_MODEL || "gpt-5-mini",
  });
  return result;
}

function parseJson(content: string) {
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")) as Record<string, unknown>;
}

function retryableStatus(status: number) {
  return RETRYABLE.has(status) || status >= 500;
}

function runtimeScore(provider: SiteAgentProvider, health?: RuntimeHealth) {
  if (!health) return PROVIDER_PRIORITY[provider];
  const successes = Math.max(0, Number(health.successes) || 0);
  const failures = Math.max(0, Number(health.failures) || 0);
  const total = successes + failures;
  const reliability = total ? (successes / total - 0.5) * 16 : 0;
  const consecutivePenalty = Math.min(Math.max(0, Number(health.consecutiveFailures) || 0) * 10, 30);
  const latency = Math.max(0, Number(health.averageLatencyMs) || 0);
  const latencyPenalty = latency ? Math.min(latency / 2_500, 8) : 0;
  return PROVIDER_PRIORITY[provider] + reliability - consecutivePenalty - latencyPenalty;
}

async function markSuccess(provider: SiteAgentProvider, status: number, latencyMs: number) {
  recordProviderSuccess(provider, status, latencyMs);
  await persistProviderSuccess(provider, status, latencyMs).catch(() => undefined);
}

async function markFailure(
  provider: SiteAgentProvider,
  input: { status?: number; error?: unknown; latencyMs: number },
) {
  recordProviderFailure(provider, input);
  await persistProviderFailure(provider, input).catch(() => undefined);
}

export async function siteAgentJson(request: JsonProviderRequest): Promise<Record<string, unknown>> {
  const configured = providers(request.groqApiKey, request.openaiApiKey);
  if (!configured.length) throw new Error("Site Agent provider is not configured");

  // Hydrate shared Supabase-backed provider state before choosing an expensive
  // Site Agent model. Availability is the hard gate; observed reliability and
  // latency decide ordering among providers that are currently usable.
  await hydratePersistentProviderHealth().catch(() => undefined);
  const snapshot = providerHealthSnapshot() as Record<string, RuntimeHealth>;
  const available = [...configured].sort((a, b) => {
    const aAvailable = canAttemptProvider(a.provider);
    const bAvailable = canAttemptProvider(b.provider);
    if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
    return runtimeScore(b.provider, snapshot[b.provider]) - runtimeScore(a.provider, snapshot[a.provider]);
  });

  const fetchImpl = request.fetchImpl || fetch;
  const failures: string[] = [];

  for (const config of available) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(request.timeoutMs || DEFAULT_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          response_format: { type: "json_object" },
          temperature: 0.12,
          max_completion_tokens: Math.min(request.maxTokens || 1000, 1400),
          ...(config.provider === "groq" ? { reasoning_effort: "none" } : {}),
        }),
      });
    } catch (error) {
      const latencyMs = Date.now() - started;
      await markFailure(config.provider, { error, latencyMs });
      failures.push(`${config.provider}:${error instanceof Error ? error.message : "network_error"}`);
      continue;
    }

    const latencyMs = Date.now() - started;
    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      await markFailure(config.provider, { status: response.status, error: message, latencyMs });
      failures.push(`${config.provider}:${message}`);
      if (retryableStatus(response.status)) continue;
      continue;
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      await markFailure(config.provider, { status: response.status, error: "empty_response", latencyMs });
      failures.push(`${config.provider}:empty_response`);
      continue;
    }
    try {
      const parsed = parseJson(content);
      await markSuccess(config.provider, response.status, latencyMs);
      return parsed;
    } catch {
      await markFailure(config.provider, { status: response.status, error: "invalid_json", latencyMs });
      failures.push(`${config.provider}:invalid_json`);
    }
  }

  throw new Error(`Site Agent providers exhausted: ${failures.join(" | ").slice(0, 1200)}`);
}
