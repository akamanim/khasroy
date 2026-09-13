import { AsyncLocalStorage } from "node:async_hooks";
import { resolveSecret } from "@/lib/server-integrations";

export type ExternalTeacher = "openai" | "gemini" | "kimi";
export type ExternalTeacherKeys = Partial<Record<ExternalTeacher, string>>;
export type TeacherMessage = { role: "user" | "assistant"; content: string };
export type TeacherResponseData = {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; type?: string; code?: string };
};
export type TeacherRun = {
  response: Response;
  data: TeacherResponseData | null;
  provider: ExternalTeacher;
  model: string;
  latencyMs: number;
};
type RunArgs = {
  systemContent: string;
  history: TeacherMessage[];
  maxCompletion: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 16_000;
const requestKeys = new AsyncLocalStorage<ExternalTeacherKeys>();

function env(name: string) {
  return process.env[name]?.trim() || "";
}
function enabledFlag(name: string, defaultEnabled: boolean) {
  const value = env(name).toLowerCase();
  if (!value) return defaultEnabled;
  return !["0", "false", "off", "disabled", "no"].includes(value);
}
function contextKey(provider: ExternalTeacher) {
  return requestKeys.getStore()?.[provider]?.trim() || "";
}
function envKey(provider: ExternalTeacher) {
  if (provider === "openai") return env("OPENAI_API_KEY");
  if (provider === "gemini") return env("GEMINI_API_KEY");
  return env("MOONSHOT_API_KEY") || env("KIMI_API_KEY");
}
function vaultCapable() {
  return Boolean(env("KHASROY_OWNER_KEY"));
}
async function requestKey(provider: ExternalTeacher) {
  const direct = contextKey(provider) || envKey(provider);
  if (direct) return direct;
  const ownerKey = env("KHASROY_OWNER_KEY");
  if (!ownerKey) return "";
  try {
    return await resolveSecret(ownerKey, provider, []);
  } catch (error) {
    console.error(`Khasroy ${provider} vault credential lookup failed`, error);
    return "";
  }
}
export function withExternalTeacherKeys<T>(keys: ExternalTeacherKeys, run: () => T): T {
  return requestKeys.run(keys, run);
}
export function externalTeacherConfigured(provider: ExternalTeacher) {
  const direct = Boolean(contextKey(provider) || envKey(provider));
  if (provider === "openai") {
    return enabledFlag("KHASROY_OPENAI_ENABLED", Boolean(contextKey(provider))) && (direct || vaultCapable());
  }
  if (provider === "gemini") {
    return enabledFlag("KHASROY_GEMINI_ENABLED", true) && (direct || vaultCapable());
  }
  return enabledFlag("KHASROY_KIMI_ENABLED", Boolean(contextKey(provider))) && (direct || vaultCapable());
}
export function externalTeacherModel(provider: ExternalTeacher) {
  if (provider === "openai") return env("KHASROY_OPENAI_MODEL") || "gpt-5.6-terra";
  if (provider === "gemini") return env("KHASROY_GEMINI_MODEL") || "gemini-3.5-flash";
  return env("KHASROY_KIMI_MODEL") || "kimi-k2.6";
}
function errorData(message: string, type: string, code: string): TeacherResponseData {
  return { error: { message, type, code } };
}
function normalizedResponse(provider: ExternalTeacher, status: number, data: TeacherResponseData) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "x-khasroy-ai-provider": provider },
  });
}
function outputTextFromOpenAI(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string" && record.text.trim()) parts.push(record.text.trim());
    }
  }
  return parts.join("\n").trim();
}

async function openAIRequest(args: RunArgs): Promise<TeacherRun> {
  const provider: ExternalTeacher = "openai";
  const model = externalTeacherModel(provider);
  const started = Date.now();
  const key = await requestKey(provider);
  if (!key) {
    const data = errorData("OpenAI key missing", "config", "missing_key");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: 0 };
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: args.systemContent, input: args.history, max_output_tokens: args.maxCompletion }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const output = payload ? outputTextFromOpenAI(payload) : "";
    const remoteError = payload?.error as Record<string, unknown> | undefined;
    const data: TeacherResponseData = output
      ? { model: typeof payload?.model === "string" ? payload.model : model, choices: [{ message: { content: output } }] }
      : errorData(
          typeof remoteError?.message === "string" ? remoteError.message : "OpenAI returned no text",
          typeof remoteError?.type === "string" ? remoteError.type : "empty_response",
          typeof remoteError?.code === "string" ? remoteError.code : "empty_response",
        );
    return { response: normalizedResponse(provider, response.status, data), data, provider, model: data.model || model, latencyMs: Date.now() - started };
  } catch (error) {
    const data = errorData(error instanceof Error ? error.message : "OpenAI unavailable", "network", "network_error");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: Date.now() - started };
  }
}

async function geminiRequest(args: RunArgs): Promise<TeacherRun> {
  const provider: ExternalTeacher = "gemini";
  const model = externalTeacherModel(provider);
  const started = Date.now();
  const key = await requestKey(provider);
  if (!key) {
    const data = errorData("Gemini key missing", "config", "missing_key");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: 0 };
  }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.systemContent }] },
        contents: args.history.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })),
        generationConfig: { maxOutputTokens: args.maxCompletion },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const output = parts
      .map((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? String((part as Record<string, unknown>).text) : "")
      .filter(Boolean)
      .join("\n")
      .trim();
    const remoteError = payload?.error as Record<string, unknown> | undefined;
    const data: TeacherResponseData = output
      ? { model, choices: [{ message: { content: output } }] }
      : errorData(
          typeof remoteError?.message === "string" ? remoteError.message : "Gemini returned no text",
          typeof remoteError?.status === "string" ? remoteError.status : "empty_response",
          typeof remoteError?.code === "number" ? String(remoteError.code) : "empty_response",
        );
    return { response: normalizedResponse(provider, response.status, data), data, provider, model, latencyMs: Date.now() - started };
  } catch (error) {
    const data = errorData(error instanceof Error ? error.message : "Gemini unavailable", "network", "network_error");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: Date.now() - started };
  }
}

async function kimiRequest(args: RunArgs): Promise<TeacherRun> {
  const provider: ExternalTeacher = "kimi";
  const model = externalTeacherModel(provider);
  const started = Date.now();
  const key = await requestKey(provider);
  if (!key) {
    const data = errorData("Kimi key missing", "config", "missing_key");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: 0 };
  }
  try {
    const response = await fetch("https://api.moonshot.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: args.systemContent }, ...args.history], max_tokens: args.maxCompletion, stream: false }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const choices = Array.isArray(payload?.choices) ? payload.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const output = typeof message?.content === "string" ? message.content.trim() : "";
    const remoteError = payload?.error as Record<string, unknown> | undefined;
    const data: TeacherResponseData = output
      ? { model: typeof payload?.model === "string" ? payload.model : model, choices: [{ message: { content: output } }] }
      : errorData(
          typeof remoteError?.message === "string" ? remoteError.message : "Kimi returned no text",
          typeof remoteError?.type === "string" ? remoteError.type : "empty_response",
          typeof remoteError?.code === "string" ? remoteError.code : "empty_response",
        );
    return { response: normalizedResponse(provider, response.status, data), data, provider, model: data.model || model, latencyMs: Date.now() - started };
  } catch (error) {
    const data = errorData(error instanceof Error ? error.message : "Kimi unavailable", "network", "network_error");
    return { response: normalizedResponse(provider, 503, data), data, provider, model, latencyMs: Date.now() - started };
  }
}

export async function runExternalTeacher(provider: ExternalTeacher, args: RunArgs): Promise<TeacherRun> {
  if (provider === "openai") return openAIRequest(args);
  if (provider === "gemini") return geminiRequest(args);
  return kimiRequest(args);
}
