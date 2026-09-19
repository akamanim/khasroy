import { siteAgentJson, type ProviderMessage } from "./site-agent-provider-runtime.ts";

export type SiteAgentV8JsonRequest = {
  messages: ProviderMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  groqApiKey?: string;
  openaiApiKey?: string;
};

/**
 * Provider boundary for Site Agent v8 calibration and verification calls.
 *
 * v8 currently inherits the multi-pass Site Intelligence/repair pipeline but
 * still owns a direct Groq transport for its calibration work. Keeping the
 * replacement behind this adapter lets v8 move to the shared Site Agent
 * runtime without changing its prompt/result contracts. The shared runtime
 * hydrates Supabase-backed provider health, ranks providers by observed
 * reliability/latency, records outcomes and falls back when one provider is
 * unavailable or rate-limited.
 */
export async function siteAgentV8Json(
  request: SiteAgentV8JsonRequest,
): Promise<Record<string, unknown>> {
  return siteAgentJson({
    messages: request.messages,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs,
    fetchImpl: request.fetchImpl,
    groqApiKey: request.groqApiKey,
    openaiApiKey: request.openaiApiKey,
  });
}

/** Drop-in bridge for v8's legacy groqJson(apiKey, messages, maxTokens) shape. */
export async function siteAgentV8LegacyJson(
  apiKey: string,
  messages: ProviderMessage[],
  maxTokens = 1000,
): Promise<Record<string, unknown>> {
  return siteAgentV8Json({
    messages,
    maxTokens,
    timeoutMs: 25_000,
    groqApiKey: apiKey,
  });
}
