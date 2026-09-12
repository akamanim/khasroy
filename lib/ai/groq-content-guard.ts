type GuardState = {
  installed: boolean;
  previousFetch: typeof fetch;
};

type JsonBody = Record<string, unknown>;

type GroqResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: unknown;
    };
  }>;
  error?: { message?: string; code?: string };
};

const GLOBAL_KEY = "__khasroyGroqContentGuard";
const GROQ_HOST = "api.groq.com";

function state() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let current = root[GLOBAL_KEY] as GuardState | undefined;
  if (!current) {
    current = {
      installed: false,
      previousFetch: globalThis.fetch.bind(globalThis),
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

function isGroqChat(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input));
    return url.hostname === GROQ_HOST && url.pathname.endsWith("/chat/completions");
  } catch {
    return false;
  }
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

function modelOf(body: JsonBody) {
  return typeof body.model === "string" ? body.model.trim() : "";
}

function hasManagedTools(body: JsonBody) {
  return Boolean(body.compound_custom) || modelOf(body).startsWith("groq/compound");
}

function prepareBody(source: JsonBody, model = modelOf(source)) {
  const body: JsonBody = { ...source, model };
  const lower = model.toLowerCase();

  // GPT-OSS returns reasoning separately by default. Khasroy needs a stable
  // final message.content, not hidden reasoning that can consume the entire
  // completion budget on short/ordinary chat requests.
  if (lower.startsWith("openai/gpt-oss-")) {
    body.include_reasoning = false;
    if (body.reasoning_effort === "medium") body.reasoning_effort = "low";
  }

  // Qwen fallbacks can disable reasoning entirely for emergency text service.
  if (lower === "qwen/qwen3.8-27b" || lower === "qwen/qwen3.6-27b") {
    body.reasoning_effort = "none";
    delete body.include_reasoning;
    delete body.reasoning_format;
  }

  return body;
}

function fallbackModels(primary: string) {
  const configured = process.env.KHASROY_GROQ_CONTENT_FALLBACKS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const defaults = [
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
  ];
  return (configured?.length ? configured : defaults).filter(
    (model) => model.toLowerCase() !== primary.toLowerCase(),
  );
}

async function responseContent(response: Response) {
  if (!response.ok) return "";
  try {
    const payload = (await response.clone().json()) as GroqResponse;
    return payload.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

function mark(response: Response, provider: string, model: string) {
  const headers = new Headers(response.headers);
  headers.set("x-khasroy-ai-provider", provider);
  headers.set("x-khasroy-ai-model", model);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function installGroqContentGuard() {
  const guard = state();
  if (guard.installed) return;

  // Capture the provider-failover fetch installed immediately before this
  // guard. This preserves HTTP-status failover while adding semantic failover
  // for the important case HTTP 200 + empty assistant content.
  guard.previousFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isGroqChat(input)) return guard.previousFetch(input, init);

    const original = parseBody(init);
    if (!original || hasManagedTools(original)) {
      return guard.previousFetch(input, init);
    }

    const primary = modelOf(original);
    const prepared = prepareBody(original, primary);
    let response = await guard.previousFetch(input, {
      ...init,
      body: JSON.stringify(prepared),
    });

    if (!response.ok || (await responseContent(response))) return response;

    console.error("Khasroy Groq returned HTTP 200 with empty content", {
      model: primary,
    });
    await response.body?.cancel().catch(() => undefined);

    for (const model of fallbackModels(primary)) {
      try {
        const nextBody = prepareBody(original, model);
        // Keep enough output room for a real final answer even when the
        // original caller used a tiny smoke-test budget.
        const requested = Number(nextBody.max_completion_tokens) || 0;
        nextBody.max_completion_tokens = Math.max(requested, 512);

        const alternate = await guard.previousFetch(input, {
          ...init,
          body: JSON.stringify(nextBody),
        });
        if (alternate.ok && (await responseContent(alternate))) {
          console.warn("Khasroy Groq semantic failover served request", { model });
          return mark(alternate, "groq-fallback", model);
        }
        await alternate.body?.cancel().catch(() => undefined);
      } catch (error) {
        console.error("Khasroy Groq semantic fallback failed", model, error);
      }
    }

    // One final primary retry with low reasoning and a sane completion budget.
    const retryBody = prepareBody(original, primary);
    retryBody.max_completion_tokens = Math.max(
      Number(retryBody.max_completion_tokens) || 0,
      1024,
    );
    if (primary.toLowerCase().startsWith("openai/gpt-oss-")) {
      retryBody.reasoning_effort = "low";
      retryBody.include_reasoning = false;
    }
    response = await guard.previousFetch(input, {
      ...init,
      body: JSON.stringify(retryBody),
    });
    return response;
  }) as typeof fetch;

  guard.installed = true;
}
