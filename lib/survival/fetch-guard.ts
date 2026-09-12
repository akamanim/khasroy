import {
  canAttemptProvider,
  recordProviderFailure,
  recordProviderSuccess,
  type SurvivalProvider,
} from "@/lib/survival/provider-health";

type GuardState = {
  installed: boolean;
  originalFetch: typeof fetch;
};

const GLOBAL_KEY = "__khasroySurvivalFetchGuard";

function state() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let current = root[GLOBAL_KEY] as GuardState | undefined;
  if (!current) {
    current = {
      installed: false,
      originalFetch: globalThis.fetch.bind(globalThis),
    };
    root[GLOBAL_KEY] = current;
  }
  return current;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function providerFor(input: RequestInfo | URL): SurvivalProvider | null {
  try {
    const url = new URL(requestUrl(input));
    if (url.hostname === "api.groq.com") return "groq";
    if (url.hostname === "ai-gateway.vercel.sh") return "vercel-gateway";
    if (
      url.hostname.endsWith("supabase.co") &&
      url.pathname.includes("/functions/v1/khasroy-chat-live")
    ) {
      return "emergency-gateway";
    }
    if (
      url.hostname.endsWith("supabase.co") &&
      url.pathname.includes("/functions/v1/khasroy-brain")
    ) {
      return "self-hosted";
    }
  } catch {
    return null;
  }
  return null;
}

function shouldFailFast(provider: SurvivalProvider) {
  // Groq has a model-level circuit breaker in provider-failover.ts. Blocking
  // Groq here would also block healthy alternate Groq models, so we only
  // observe it at provider level and let the model router decide.
  if (provider === "groq") return false;
  return !canAttemptProvider(provider);
}

function unavailableResponse(provider: SurvivalProvider) {
  return new Response(
    JSON.stringify({
      error: {
        message: `${provider} is temporarily cooling down`,
        type: "survival_circuit_open",
        code: "survival_circuit_open",
      },
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "x-khasroy-survival": "circuit-open",
        "x-khasroy-provider": provider,
      },
    },
  );
}

export function installSurvivalFetchGuard() {
  const guard = state();
  if (guard.installed) return;

  guard.originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const provider = providerFor(input);
    if (!provider) return guard.originalFetch(input, init);

    if (shouldFailFast(provider)) return unavailableResponse(provider);

    try {
      const response = await guard.originalFetch(input, init);
      if (response.ok) {
        recordProviderSuccess(provider, response.status);
      } else {
        recordProviderFailure(provider, { status: response.status });
      }
      return response;
    } catch (error) {
      recordProviderFailure(provider, { error });
      throw error;
    }
  }) as typeof fetch;

  guard.installed = true;
}
