import { getVercelOidcToken } from "@vercel/oidc";

type FailoverState = {
  installed: boolean;
  originalFetch: typeof fetch;
  groqCooldowns: Record<string, number>;
};

type JsonBody = Record<string, unknown>;

const GLOBAL_KEY = "__khasroyAiProviderFailover";
const GROQ_HOST = "api.groq.com";
const GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
const PRIMARY_TIMEOUT_MS = 22_000;
const ALTERNATE_TIMEOUT_MS = 18_000;
const GATEWAY_TIMEOUT_MS = 22_000;
const RATE_LIMIT_COOLDOWN_MS = 65_000;
const ERROR_COOLDOWN_MS = 15_000;

function globalState() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let state = root[GLOBAL_KEY] as FailoverState | undefined;
  if (!state || !state.groqCooldowns) {
    state = {
      installed: state?.installed === true,
      originalFetch: state?.originalFetch || globalThis.fetch.bind(globalThis),
      groqCooldowns: {},
    };
    root[GLOBAL_KEY] = state;
  }
  return state;
}

async function gatewayCredential() {
  const staticKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (staticKey) return staticKey;
  try {
    return (await getVercelOidcToken()) || "";
  } catch (error) {
    console.error("Khasroy AI Gateway OIDC token unavailable", error);
    return "";
  }
}

function modelsFromEnv(name: string, fallback: string[]) {
  const configured = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured?.length ? configured : fallback;
}

function modelOf(body: JsonBody | null) {
  return typeof body?.model === "string" ? body.model.trim() : "";
}

function hasVisionPayload(body: JsonBody) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return JSON.stringify(messages).includes('"image_url"');
}

function gatewayFallbackModels(body: JsonBody) {
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

function groqFallbackModels(body: JsonBody) {
  const current = modelOf(body).toLowerCase();
  if (hasVisionPayload(body)) {
    const defaults = current === "qwen/qwen3.8-27b"
      ? ["qwen/qwen3.6-27b"]
      : ["qwen/qwen3.8-27b"];
    return modelsFromEnv("KHASROY_GROQ_VISION_FALLBACKS", defaults)
      .filter((model) => model.toLowerCase() !== current);
  }

  if (current === "groq/compound") return ["groq/compound-mini"];
  if (current === "groq/compound-mini") return ["groq/compound"];

  const defaults = current === "openai/gpt-oss-20b"
    ? ["openai/gpt-oss-120b"]
    : ["openai/gpt-oss-20b"];
  return modelsFromEnv("KHASROY_GROQ_TEXT_FALLBACKS", defaults)
    .filter((model) => model.toLowerCase() !== current);
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

function usesGroqManagedTools(body: JsonBody) {
  const model = modelOf(body).toLowerCase();
  if (model.startsWith("groq/compound") || body.compound_custom) return true;

  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some((tool) => {
    if (!tool || typeof tool !== "object") return false;
    const value = tool as Record<string, unknown>;
    const type = typeof value.type === "string" ? value.type : "";
    const name = typeof value.name === "string" ? value.name : "";
    return /(browser_search|web_search|visit_website|code_interpreter)/iu.test(`${type}:${name}`);
  });
}

function gatewayBody(input: RequestInfo | URL, body: JsonBody) {
  const models = gatewayFallbackModels(body);
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

function groqBody(body: JsonBody, model: string) {
  const next: JsonBody = { ...body, model };
  const lower = model.toLowerCase();

  if (lower.startsWith("openai/gpt-oss-") && next.reasoning_effort === "none") {
    next.reasoning_effort = "low";
  }
  if (lower === "qwen/qwen3.6-27b" && ["low", "medium", "high"].includes(String(next.reasoning_effort))) {
    next.reasoning_effort = "default";
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

function markResponse(response: Response, provider: string, model?: string) {
  const headers = new Headers(response.headers);
  headers.set("x-khasroy-ai-provider", provider);
  if (model) headers.set("x-khasroy-ai-model", model);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function markCooldown(state: FailoverState, model: string, status?: number) {
  if (!model) return;
  state.groqCooldowns[model] = Date.now() +
    (status === 429 ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS);
}

function coolingDown(state: FailoverState, model: string) {
  return Boolean(model && (state.groqCooldowns[model] || 0) > Date.now());
}

async function callGroqModel(
  state: FailoverState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: JsonBody,
  model: string,
) {
  let response: Response;
  try {
    response = await state.originalFetch(input, {
      ...init,
      body: JSON.stringify(groqBody(body, model)),
      signal: boundedSignal(init?.signal, ALTERNATE_TIMEOUT_MS),
    });
  } catch (error) {
    markCooldown(state, model);
    console.error("Khasroy Groq alternate model request failed", model, error);
    return null;
  }

  if (response.ok) {
    console.warn("Khasroy AI provider failover: alternate Groq model served request", { model });
    return markResponse(response, "groq-fallback", model);
  }

  if (retryableStatus(response.status)) markCooldown(state, model, response.status);
  console.error("Khasroy Groq alternate model rejected request", model, response.status);
  await response.body?.cancel().catch(() => undefined);
  return null;
}

async function callGateway(
  state: FailoverState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: JsonBody,
  credential: string,
) {
  if (!credential) return null;

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${credential}`);
  headers.set("Content-Type", "application/json");
  headers.set("x-khasroy-route", "provider-failover");

  const response = await state.originalFetch(gatewayUrl(input), {
    ...init,
    headers,
    body: JSON.stringify(gatewayBody(input, body)),
    signal: boundedSignal(init?.signal, GATEWAY_TIMEOUT_MS),
  });

  if (response.ok) {
    console.warn("Khasroy AI provider failover: Vercel AI Gateway served request", {
      status: response.status,
      vision: hasVisionPayload(body),
    });
    return markResponse(response, "gateway");
  }

  console.error("Khasroy AI Gateway fallback failed", response.status);
  await response.body?.cancel().catch(() => undefined);
  return null;
}

async function tryGroqAlternates(
  state: FailoverState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: JsonBody,
) {
  const alternates = groqFallbackModels(body);
  for (const model of alternates) {
    if (coolingDown(state, model)) continue;
    const response = await callGroqModel(state, input, init, body, model);
    if (response) return response;
  }
  return null;
}

export function providerFailoverInfo() {
  const state = globalState();
  const now = Date.now();
  return {
    installed: state.installed,
    gatewayStaticKeyConfigured: Boolean(process.env.AI_GATEWAY_API_KEY?.trim()),
    oidcRuntimeEnabled: Boolean(process.env.VERCEL),
    coolingGroqModels: Object.entries(state.groqCooldowns)
      .filter(([, until]) => until > now)
      .map(([model]) => model),
    managedGroqToolsProtected: true,
    groqTextFallbacks: groqFallbackModels({ model: "openai/gpt-oss-120b" }),
    groqVisionFallbacks: groqFallbackModels({ model: "qwen/qwen3.6-27b", messages: [{ content: [{ type: "image_url" }] }] }),
    gatewayTextModels: gatewayFallbackModels({}),
    gatewayVisionModels: gatewayFallbackModels({ messages: [{ content: [{ type: "image_url" }] }] }),
  };
}

export async function testGatewayConnection() {
  const state = globalState();
  const credential = await gatewayCredential();
  if (!credential) return { ok: false, configured: false, status: 0, model: null as string | null };
  try {
    const response = await state.originalFetch(`${GATEWAY_ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        models: ["openai/gpt-5.6-sol"],
        messages: [{ role: "user", content: "Reply with exactly OK" }],
        max_completion_tokens: 8,
        temperature: 0,
      }),
    });
    const data = await response.json().catch(() => null) as { model?: string } | null;
    return { ok: response.ok, configured: true, status: response.status, model: data?.model || null };
  } catch {
    return { ok: false, configured: true, status: 0, model: null as string | null };
  }
}

export function installProviderFailover() {
  const state = globalState();
  if (state.installed) return providerFailoverInfo();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isGroqAiRequest(input)) return state.originalFetch(input, init);

    const body = parseBody(init);
    if (!body) return state.originalFetch(input, init);

    const primaryModel = modelOf(body);
    const gatewayEligible = !usesGroqManagedTools(body);

    if (coolingDown(state, primaryModel)) {
      const alternate = await tryGroqAlternates(state, input, init, body);
      if (alternate) return alternate;

      if (gatewayEligible) {
        const credential = await gatewayCredential();
        if (credential) {
          try {
            const gateway = await callGateway(state, input, init, body, credential);
            if (gateway) return gateway;
          } catch (error) {
            console.error("Khasroy AI Gateway cooldown route failed", error);
          }
        }
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
      markCooldown(state, primaryModel, primaryResponse.status);
    } catch (error) {
      primaryError = error;
      markCooldown(state, primaryModel);
    }

    const alternate = await tryGroqAlternates(state, input, init, body);
    if (alternate) {
      await primaryResponse?.body?.cancel().catch(() => undefined);
      return alternate;
    }

    if (gatewayEligible) {
      const credential = await gatewayCredential();
      if (credential) {
        try {
          const gateway = await callGateway(state, input, init, body, credential);
          if (gateway) {
            await primaryResponse?.body?.cancel().catch(() => undefined);
            return gateway;
          }
        } catch (error) {
          console.error("Khasroy AI Gateway failover request failed", error);
        }
      }
    }

    if (primaryResponse) return primaryResponse;
    throw primaryError instanceof Error ? primaryError : new Error("AI provider request failed");
  }) as typeof fetch;

  state.installed = true;
  return providerFailoverInfo();
}
