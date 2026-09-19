import { siteAgentJson, type ProviderMessage } from "./site-agent-provider-runtime.ts";

export type SiteIntelligenceJsonRequest = {
  messages: ProviderMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  groqApiKey?: string;
  openaiApiKey?: string;
};

/**
 * Shared JSON runtime for Site Intelligence v3.
 *
 * Keeping v3 behind this adapter prevents business mapping, design planning,
 * visual comparison and repair passes from re-introducing direct provider
 * calls. The underlying Site Agent runtime hydrates persistent Supabase health,
 * ranks usable providers by observed reliability/latency, records outcomes and
 * falls back when one provider is rate-limited or unavailable.
 */
export async function siteIntelligenceJson(
  request: SiteIntelligenceJsonRequest,
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

/**
 * Drop-in bridge for the legacy v3 groqJson call shape.
 * This lets the Site Intelligence job move each business-map/design/repair call
 * to the resilient runtime without changing prompt construction or result parsing.
 */
export async function siteIntelligenceLegacyJson(
  apiKey: string,
  messages: ProviderMessage[],
  maxTokens = 1000,
): Promise<Record<string, unknown>> {
  return siteIntelligenceJson({
    messages,
    maxTokens,
    timeoutMs: 25_000,
    groqApiKey: apiKey,
  });
}
