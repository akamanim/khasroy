import { getVercelOidcToken } from "@vercel/oidc";
import {
  canAttemptProvider,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/survival/provider-health";
import {
  hydratePersistentProviderHealth,
  persistProviderFailure,
  persistProviderSuccess,
} from "@/lib/survival/persistent-provider-health";

type JsonBody = Record<string, unknown>;
type GateState = { installed: boolean; originalFetch: typeof fetch };

const GLOBAL_KEY = "__khasroyPersistentProviderGate";
const GROQ_HOST = "api.groq.com";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const TIMEOUT_MS = 24_000;

function state() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let value = root[GLOBAL_KEY] as GateState | undefined;
  if (!value) {
    value = { installed: false, originalFetch: globalThis.fetch.bind(globalThis) };
    root[GLOBAL_KEY] = value;
  }
  return value;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function parseBody(init?: RequestInit): JsonBody | null {
  if (typeof init?.body !== "string") return null;
  try {
    const value = JSON.parse(init.body) as unknown;
    return value && typeof value === "object" ? value as JsonBody : null;
  } catch {
    return null;
  }
}

function isGroqChat(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input));
    return url.hostname === GROQ_HOST && url.pathname.endsWith("/chat/completions");
  } catch {
    return false;
  }
}

function hasManagedTools(body: JsonBody) {
  if (body.compound_custom) return true;
  const model = typeof body.model === "string" ? body.model.toLowerCase() : "";
  if (model.startsWith("groq/compound")) return true;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some((tool) => {
    if (!tool || typeof tool !== "object") return false;
    const value = tool as Record<string, unknown>;
    return /(browser_search|web_search|visit_website|code_interpreter)/iu.test(
      `${value.type || ""}:${value.name || ""}`,
    );
  });
}

function hasVision(body: JsonBody) {
  return JSON.stringify(body.messages || []).includes('"image_url"');
}

function modelList(body: JsonBody) {
  const env = hasVision(body)
    ? process.env.KHASROY_GATEWAY_VISION_MODELS
    : process.env.KHASROY_GATEWAY_TEXT_MODELS;
  const configured = env?.split(",").map((value) => value.trim()).filter(Boolean);
  return configured?.length
    ? configured
    : ["google/gemini-3.6-flash", "openai/gpt-5.6-sol"];
}

async function credential() {
  const staticKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (staticKey) return staticKey;
  try {
    return await getVercelOidcToken({ expirationBufferMs: 2 * 60_000 });
  } catch {
    return "";
  }
}

function gatewayBody(body: JsonBody) {
  const models = modelList(body);
  const next: JsonBody = { ...body, model: models[0], models: models.slice(1) };
  delete next.compound_custom;
  if (next.reasoning_effort === "none") delete next.reasoning_effort;
  return next;
}

async function gatewayRequest(fetcher: typeof fetch, body: JsonBody, init?: RequestInit) {
  const token = await credential();
  if (!token) {
    return new Response(JSON.stringify({
      error: { message: "AI Gateway credential unavailable", code: "gateway_not_configured" },
    }), { status: 503, headers: { "Content-Type": "application/json", "x-khasroy-ai-provider": "gateway" } });
  }

  const headers = new Headers(init?.headers);
  headers.delete("Authorization");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  headers.set("x-khasroy-route", "persistent-provider-gate");
  const started = Date.now();

  try {
    const response = await fetcher(GATEWAY_URL, {
      ...init,
      method: "POST",
      headers,
      body: JSON.stringify(gatewayBody(body)),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (response.ok) {
      recordProviderSuccess("vercel-gateway", response.status, latencyMs);
      await persistProviderSuccess("vercel-gateway", response.status, latencyMs);
    } else {
      recordProviderFailure("vercel-gateway", { status: response.status, error: "gateway_request_failed", latencyMs });
      await persistProviderFailure("vercel-gateway", { status: response.status, error: "gateway_request_failed", latencyMs });
    }
    const marked = new Headers(response.headers);
    marked.set("x-khasroy-ai-provider", "gateway-persistent-fallback");
    marked.set("x-khasroy-ai-model", modelList(body)[0]);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: marked,
    });
  } catch (error) {
    const latencyMs = Date.now() - started;
    recordProviderFailure("vercel-gateway", { error, latencyMs });
    await persistProviderFailure("vercel-gateway", { error, latencyMs });
    return new Response(JSON.stringify({
      error: { message: "AI Gateway unavailable", code: "gateway_unavailable" },
    }), { status: 503, headers: { "Content-Type": "application/json", "x-khasroy-ai-provider": "gateway" } });
  }
}

export async function testPersistentGateway() {
  const body: JsonBody = {
    model: "gateway-probe",
    messages: [{ role: "user", content: "Reply with exactly OK" }],
    max_completion_tokens: 8,
    temperature: 0,
  };
  const started = Date.now();
  const response = await gatewayRequest(state().originalFetch, body);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const text = typeof message?.content === "string" ? message.content.trim() : "";
  return {
    configured: response.status !== 503 || Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL),
    ok: response.ok && Boolean(text),
    status: response.status,
    model: response.headers.get("x-khasroy-ai-model") || null,
    latencyMs: Date.now() - started,
  };
}

export function installPersistentProviderGate() {
  const current = state();
  if (current.installed) return { installed: true };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isGroqChat(input)) return current.originalFetch(input, init);
    const body = parseBody(init);
    if (!body || hasManagedTools(body)) return current.originalFetch(input, init);

    await hydratePersistentProviderHealth().catch(() => undefined);
    if (canAttemptProvider("groq")) return current.originalFetch(input, init);

    console.warn("Khasroy persistent provider gate: Groq is blocked, routing directly to AI Gateway", {
      vision: hasVision(body),
    });
    return gatewayRequest(current.originalFetch, body, init);
  }) as typeof fetch;

  current.installed = true;
  return { installed: true };
}
