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

const DEFAULT_TIMEOUT_MS = 25_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

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

export async function siteAgentJson(request: JsonProviderRequest): Promise<Record<string, unknown>> {
  const available = providers(request.groqApiKey, request.openaiApiKey);
  if (!available.length) throw new Error("Site Agent provider is not configured");
  const fetchImpl = request.fetchImpl || fetch;
  const failures: string[] = [];

  for (const config of available) {
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
      failures.push(`${config.provider}:${error instanceof Error ? error.message : "network_error"}`);
      continue;
    }

    const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      failures.push(`${config.provider}:${message}`);
      if (retryableStatus(response.status)) continue;
      continue;
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) { failures.push(`${config.provider}:empty_response`); continue; }
    try { return parseJson(content); }
    catch { failures.push(`${config.provider}:invalid_json`); }
  }

  throw new Error(`Site Agent providers exhausted: ${failures.join(" | ").slice(0, 1200)}`);
}
