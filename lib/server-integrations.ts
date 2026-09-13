const INTEGRATION_ENDPOINT =
  process.env.KHASROY_WEB_STUDIO_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const INTEGRATION_KEY =
  process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

export type IntegrationProvider =
  | "github"
  | "vercel"
  | "instagram"
  | "groq"
  | "openai"
  | "gemini"
  | "kimi";

export type IntegrationInfo = {
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  updated_at?: string | null;
};

export type ResolvedAISecrets = {
  groq: string;
  teachers: {
    openai?: string;
    gemini?: string;
    kimi?: string;
  };
};

async function call<T>(ownerKey: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(INTEGRATION_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: INTEGRATION_KEY },
    body: JSON.stringify({ ownerKey, ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : "integration_request_failed";
    throw new Error(`${detail}:${response.status}`);
  }
  return data as T;
}

export async function setIntegration(
  ownerKey: string,
  provider: IntegrationProvider,
  secret: string,
  config: Record<string, unknown> = {},
) {
  return call<{ ok: true; integration: IntegrationInfo }>(ownerKey, {
    action: "set_integration",
    provider,
    secret,
    config,
  });
}

export async function getIntegration(
  ownerKey: string,
  provider: IntegrationProvider,
): Promise<{ secret: string; config: Record<string, unknown> } | null> {
  try {
    const result = await call<{
      ok: true;
      secret: string;
      config?: Record<string, unknown>;
    }>(ownerKey, { action: "get_integration", provider });
    return { secret: result.secret, config: result.config || {} };
  } catch (error) {
    if (/integration_not_found:404/iu.test(String(error))) return null;
    throw error;
  }
}

export async function listIntegrations(ownerKey: string): Promise<IntegrationInfo[]> {
  const result = await call<unknown>(ownerKey, { action: "list_integrations" });
  return Array.isArray(result) ? result as IntegrationInfo[] : [];
}

export async function deleteIntegration(ownerKey: string, provider: IntegrationProvider) {
  return call<{ ok: true }>(ownerKey, { action: "delete_integration", provider });
}

export async function resolveSecret(
  ownerKey: string,
  provider: IntegrationProvider,
  envCandidates: Array<string | undefined>,
) {
  for (const candidate of envCandidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  const stored = await getIntegration(ownerKey, provider);
  return stored?.secret?.trim() || "";
}

export async function resolveAISecrets(ownerKey: string): Promise<ResolvedAISecrets> {
  const [groq, openai, gemini, kimi] = await Promise.all([
    resolveSecret(ownerKey, "groq", [process.env.GROQ_API_KEY]).catch(() => process.env.GROQ_API_KEY?.trim() || ""),
    resolveSecret(ownerKey, "openai", [process.env.OPENAI_API_KEY]).catch(() => process.env.OPENAI_API_KEY?.trim() || ""),
    resolveSecret(ownerKey, "gemini", [process.env.GEMINI_API_KEY]).catch(() => process.env.GEMINI_API_KEY?.trim() || ""),
    resolveSecret(ownerKey, "kimi", [process.env.MOONSHOT_API_KEY, process.env.KIMI_API_KEY]).catch(() => process.env.MOONSHOT_API_KEY?.trim() || process.env.KIMI_API_KEY?.trim() || ""),
  ]);
  return {
    groq,
    teachers: {
      ...(openai ? { openai } : {}),
      ...(gemini ? { gemini } : {}),
      ...(kimi ? { kimi } : {}),
    },
  };
}
