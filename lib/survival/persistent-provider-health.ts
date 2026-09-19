import {
  applyPersistentProviderHealth,
  type SurvivalProvider,
} from "./provider-health.ts";

const MEMORY_ENDPOINT =
  process.env.KHASROY_MEMORY_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-memory";
const MEMORY_API_KEY =
  process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";
const HYDRATE_TTL_MS = 20_000;
const GLOBAL_KEY = "__khasroyPersistentProviderHealth";

type PersistentRow = {
  provider: string;
  state: string;
  last_status: number | null;
  last_error_category: string | null;
  blocked_until: string | null;
  last_checked_at: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_latency_ms: number | null;
  successes: number;
  failures: number;
};

type PersistState = { hydratedAt: number; hydration?: Promise<void> };

function runtimeState() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let value = root[GLOBAL_KEY] as PersistState | undefined;
  if (!value) {
    value = { hydratedAt: 0 };
    root[GLOBAL_KEY] = value;
  }
  return value;
}

function ownerKey() {
  return process.env.KHASROY_OWNER_KEY?.trim() || "";
}

async function memoryCall<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(MEMORY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: MEMORY_API_KEY,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`provider_health_memory_${response.status}`);
  return await response.json() as T;
}

function survivalProvider(value: string): SurvivalProvider | null {
  const known: SurvivalProvider[] = [
    "self-hosted", "groq", "openai", "gemini", "kimi", "vercel-gateway",
    "emergency-gateway", "web-search", "sandbox", "memory",
  ];
  return known.includes(value as SurvivalProvider) ? value as SurvivalProvider : null;
}

export async function hydratePersistentProviderHealth(force = false) {
  const key = ownerKey();
  if (!key) return;
  const state = runtimeState();
  if (!force && state.hydratedAt && Date.now() - state.hydratedAt < HYDRATE_TTL_MS) return;
  if (state.hydration) return state.hydration;

  state.hydration = (async () => {
    const rows = await memoryCall<PersistentRow[]>({ action: "provider_health", ownerKey: key });
    for (const row of rows) {
      const provider = survivalProvider(row.provider);
      if (!provider) continue;
      applyPersistentProviderHealth(provider, {
        state: row.state,
        lastStatus: row.last_status,
        lastErrorCategory: row.last_error_category,
        blockedUntil: row.blocked_until,
        successes: row.successes,
        failures: row.failures,
        lastSuccessAt: row.last_success_at,
        lastFailureAt: row.last_failure_at,
        lastLatencyMs: row.last_latency_ms,
      });
    }
    state.hydratedAt = Date.now();
  })().catch((error) => {
    console.error("Khasroy persistent provider-health hydration failed", error);
  }).finally(() => {
    state.hydration = undefined;
  });

  return state.hydration;
}

function classify(status: number | null, error: unknown) {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string" ? error : "";
  const normalized = text.toLowerCase();

  if (status === 401 || status === 403) {
    return { state: "auth_failed", category: "auth_failed", ttlMs: 6 * 60 * 60_000 };
  }
  if (status === 429 && /(credit|billing|balance|insufficient|suspend|recharge)/iu.test(normalized)) {
    return { state: "billing_blocked", category: "billing_blocked", ttlMs: 6 * 60 * 60_000 };
  }
  if (status === 429 && /(quota|resource_exhausted|resource exhausted|tokens per day|daily|rate limit|limit reached)/iu.test(normalized)) {
    return { state: "quota_exhausted", category: "quota_exhausted", ttlMs: 60 * 60_000 };
  }
  if (status === 429) {
    return { state: "temporary_failure", category: "rate_limited", ttlMs: 15 * 60_000 };
  }
  if (/timeout|abort/iu.test(normalized)) {
    return { state: "temporary_failure", category: "timeout", ttlMs: 2 * 60_000 };
  }
  return { state: "temporary_failure", category: "request_failed", ttlMs: 2 * 60_000 };
}

export async function persistProviderSuccess(
  provider: SurvivalProvider,
  status = 200,
  latencyMs?: number | null,
) {
  const key = ownerKey();
  if (!key) return;
  await memoryCall({
    action: "update_provider_health",
    ownerKey: key,
    provider,
    state: "healthy",
    lastStatus: status,
    lastErrorCategory: "",
    blockedUntil: new Date(0).toISOString(),
    lastLatencyMs: latencyMs ?? null,
    successDelta: 1,
  }).catch((error) => console.error("Khasroy provider-health success persistence failed", provider, error));
  runtimeState().hydratedAt = 0;
}

export async function persistProviderFailure(
  provider: SurvivalProvider,
  options: { status?: number | null; error?: unknown; latencyMs?: number | null } = {},
) {
  const key = ownerKey();
  if (!key) return;
  const status = options.status ?? null;
  const classified = classify(status, options.error);
  await memoryCall({
    action: "update_provider_health",
    ownerKey: key,
    provider,
    state: classified.state,
    lastStatus: status,
    lastErrorCategory: classified.category,
    blockedUntil: new Date(Date.now() + classified.ttlMs).toISOString(),
    lastLatencyMs: options.latencyMs ?? null,
    failureDelta: 1,
  }).catch((error) => console.error("Khasroy provider-health failure persistence failed", provider, error));
  runtimeState().hydratedAt = 0;
}
