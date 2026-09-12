export type SurvivalProvider =
  | "self-hosted"
  | "groq"
  | "vercel-gateway"
  | "emergency-gateway"
  | "web-search"
  | "sandbox"
  | "memory";

type ProviderState = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  cooldownUntil: number;
  lastStatus: number | null;
  lastError: string | null;
};

type SurvivalState = Record<SurvivalProvider, ProviderState>;

const GLOBAL_KEY = "__khasroySurvivalProviderHealth";

function blank(): ProviderState {
  return {
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    cooldownUntil: 0,
    lastStatus: null,
    lastError: null,
  };
}

function initialState(): SurvivalState {
  return {
    "self-hosted": blank(),
    groq: blank(),
    "vercel-gateway": blank(),
    "emergency-gateway": blank(),
    "web-search": blank(),
    sandbox: blank(),
    memory: blank(),
  };
}

function store(): SurvivalState {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let value = root[GLOBAL_KEY] as SurvivalState | undefined;
  if (!value) {
    value = initialState();
    root[GLOBAL_KEY] = value;
  }
  return value;
}

function cooldownMs(status: number | null, consecutiveFailures: number) {
  if (status === 429) return 70_000;
  if (status === 401 || status === 403) return 5 * 60_000;
  const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 5);
  return Math.min(5_000 * 2 ** exponent, 120_000);
}

export function canAttemptProvider(provider: SurvivalProvider) {
  return store()[provider].cooldownUntil <= Date.now();
}

export function recordProviderSuccess(
  provider: SurvivalProvider,
  status = 200,
) {
  const state = store()[provider];
  state.successes += 1;
  state.consecutiveFailures = 0;
  state.lastSuccessAt = Date.now();
  state.cooldownUntil = 0;
  state.lastStatus = status;
  state.lastError = null;
}

export function recordProviderFailure(
  provider: SurvivalProvider,
  options: { status?: number | null; error?: unknown } = {},
) {
  const state = store()[provider];
  const status = options.status ?? null;
  state.failures += 1;
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();
  state.lastStatus = status;
  state.lastError =
    options.error instanceof Error
      ? options.error.message.slice(0, 240)
      : typeof options.error === "string"
        ? options.error.slice(0, 240)
        : null;
  state.cooldownUntil = Date.now() + cooldownMs(status, state.consecutiveFailures);
}

export function providerHealthSnapshot() {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(store()).map(([provider, state]) => [
      provider,
      {
        available: state.cooldownUntil <= now,
        successes: state.successes,
        failures: state.failures,
        consecutiveFailures: state.consecutiveFailures,
        cooldownRemainingMs: Math.max(0, state.cooldownUntil - now),
        lastSuccessAt: state.lastSuccessAt
          ? new Date(state.lastSuccessAt).toISOString()
          : null,
        lastFailureAt: state.lastFailureAt
          ? new Date(state.lastFailureAt).toISOString()
          : null,
        lastStatus: state.lastStatus,
        lastError: state.lastError,
      },
    ]),
  );
}
