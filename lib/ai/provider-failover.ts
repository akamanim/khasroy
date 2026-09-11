type FailoverState = {
  installed: boolean;
  originalFetch: typeof fetch;
  groqCooldownUntil: number;
};

type JsonBody = Record<string, unknown>;

const GLOBAL_KEY = "__khasroyAiProviderFailover";
const GROQ_HOST = "api.groq.com";
const GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
const PRIMARY_TIMEOUT_MS = 22_000;
const GATEWAY_TIMEOUT_MS = 22_000;
const RATE_LIMIT_COOLDOWN_MS = 65_000;
const ERROR_COOLDOWN_MS = 15_000;

function globalState() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let state = root[GLOBAL_KEY] as FailoverState | undefined;
  if (!state) {
    state = {
      installed: false,
      originalFetch: globalThis.fetch.bind(globalThis),
      groqCooldownUntil: 0,
    };
    root[GLOBAL_KEY] = state;
  }
  return state;
}

function gatewayCredential() {
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "";
}

function modelsFromEnv(name: string, fallback: string[]) {
  const configured = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured?.length ? configured : fallback;
}

function hasVisionPayload(body: JsonBody) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return JSON.stringify(messages).includes('"image_url"');
}

function fallbackModels(body: JsonBody) {
  return hasVisionPayload(body)
    ? modelsFromEnv("KHASROY_GATEWAY_VISION_MODELS", [
        "google/gemini-3.6-flash",
        "openai/gpt-5.6-sol",
      ])
    : modelsFromEnv("KHASROY_GATEWAY_TEXT_MODELS", [
        "google/gemini-3.6-flash",
        "openai/gpt-5.6-sol",
      ]);
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isGroqAiRequest(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input));
    return (
      url.hostname === GROQ_HOST &&
      (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/responses"))
    );
  } catch {
    return false;
  }
}

function gatewayUrl(input: RequestInfo | URL) {
  const source = new URL(requestUrl(input));
  const suffix = source.pathname.endsWith("/responses") ? "/v1/responses" : "/v1/chat/completions";
  return `${GATEWAY_ORIGIN}${suffix}`;
}

function parseBody(init?: RequestInit): JsonBody | null {
  if (typeof init?.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as JsonBody) : null;
  } catch {
    return null;
  }
}

function gatewayBody(input: RequestInfo | URL, body: JsonBody) {
  const models = fallbackModels(body);
  const next: JsonBody = { ...body, model: models[0] };
  delete next.compound_custom;
  if (next.reasoning_effort === "none") delete next.reasoning_effort;

  const path = new URL(requestUrl(input)).pathname;
  if (path.endsWith("/responses")) {
    next.providerOptions = {
      ...((next.providerOptions as Record<string, unknown> | undefined) || {}),
      gateway: {
        models: models.slice(1),
        tags: ["app:khasroy", "route:automatic-failover"],
      },
    };
  } else {
    next.models = models.slice(1);
    next.providerOptions = {
      ...((next.providerOptions as Record<string, unknown> | undefined) || {}),
      gateway: {
        tags: ["app:khasroy", hasVisionPayload(body) ? "mode:vision" : "mode:text"],
      },
    };
  }
  return next;
}

function boundedSignal(existing: AbortSignal | null | undefined, timeoutMs: number) {
  const timer = AbortSignal.timeout(timeoutMs);
  if (!existing) return timer;
  try {
    return AbortSignal.any([existing, timer]);
  } catch {
    return existing;
  }
}

async function callGateway(
  state: FailoverState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: JsonBody,
) {
  const credential = gatewayCredential();
  if (!credential) return null;

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${credential}`);
  headers.set("Content-Type", "application/json");
  headers.set("x-khasroy-route", "provider-failover");

  const response = await state.originalFetch(gatewayUrl(input), {
    ...init,
    headers,
    body: JSON.stringify(gatewayBody(input, body)),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });

  if (response.ok) {
    console.warn("Khasroy AI provider failover: Vercel AI Gateway served request", {
      status: response.status,
      vision: hasVisionPayload(body),
    });
    return response;
  }

  console.error("Khasroy AI Gateway fallback failed", response.status);
  await response.body?.cancel().catch(() => undefined);
  return null;
}

export function providerFailoverInfo() {
  const state = globalState();
  return {
    installed: state.installed,
    gatewayConfigured: Boolean(gatewayCredential()),
    groqCoolingDown: state.groqCooldownUntil > Date.now(),
    fallbackTextModels: fallbackModels({}),
    fallbackVisionModels: fallbackModels({ messages: [{ content: [{ type: "image_url" }] }] }),
  };
}

export function installProviderFailover() {
  const state = globalState();
  if (state.installed) return providerFailoverInfo();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isGroqAiRequest(input)) return state.originalFetch(input, init);

    const body = parseBody(init);
    const gatewayReady = Boolean(body && gatewayCredential());

    if (gatewayReady && state.groqCooldownUntil > Date.now()) {
      try {
        const gateway = await callGateway(state, input, init, body!);
        if (gateway) return gateway;
      } catch (error) {
        console.error("Khasroy AI Gateway cooldown route failed", error);
      }
    }

    let primaryResponse: Response | null = null;
    let primaryError: unknown;
    try {
      primaryResponse = await state.originalFetch(input, {
        ...init,
        signal: boundedSignal(init?.signal, PRIMARY_TIMEOUT_MS),
      });
      if (!retryableStatus(primaryResponse.status)) return primaryResponse;

      state.groqCooldownUntil = Date.now() +
        (primaryResponse.status === 429 ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS);
    } catch (error) {
      primaryError = error;
      state.groqCooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
    }

    if (gatewayReady) {
      try {
        const gateway = await callGateway(state, input, init, body!);
        if (gateway) return gateway;
      } catch (error) {
        console.error("Khasroy AI Gateway failover request failed", error);
      }
    }

    if (primaryResponse) return primaryResponse;
    throw primaryError instanceof Error ? primaryError : new Error("AI provider request failed");
  }) as typeof fetch;

  state.installed = true;
  return providerFailoverInfo();
}
