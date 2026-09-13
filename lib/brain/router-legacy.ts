import { getVercelOidcToken } from "@vercel/oidc";
import { searchWebDirect } from "@/lib/server-web";
import {
  selfHostedChat,
  selfHostedHealth,
} from "@/lib/brain/providers/self-hosted";
import {
  externalTeacherConfigured,
  runExternalTeacher,
  type ExternalTeacher,
} from "@/lib/brain/providers/external-teachers";
import {
  canAttemptProvider,
  providerHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  type SurvivalProvider,
} from "@/lib/survival/provider-health";

export type BrainMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BrainMode = "chat" | "repository" | "research" | "sandbox" | "agentic";
export type BrainProvider = "self-hosted" | "groq" | "openai" | "gemini" | "kimi";

type ExecutedTool = {
  type?: string;
  name?: string;
  arguments?: string;
  output?: string;
  search_results?: {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
    }>;
  };
  code_results?: Array<{ text?: string }>;
};

export type BrainResponseData = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
      executed_tools?: ExecutedTool[];
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

export type BrainRun = {
  response: Response;
  data: BrainResponseData | null;
  provider: BrainProvider;
  model: string;
  mode: BrainMode;
  toolsUsed: string[];
  sources: Array<{ title: string; url: string }>;
  webToolForced: boolean;
};

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const GATEWAY_MODEL =
  process.env.KHASROY_GATEWAY_TEXT_MODEL?.trim() || "openai/gpt-4o-mini";
const PROVIDER_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.KHASROY_PROVIDER_TIMEOUT_MS) || 16_000, 8_000),
  30_000,
);
const MAX_TEACHER_ATTEMPTS = Math.min(
  Math.max(Number(process.env.KHASROY_TEACHER_MAX_ATTEMPTS) || 3, 1),
  3,
);

function forbidsWeb(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/gu, " ").trim();
  return /(не\s+(?:надо|нужно|нужен|нужна|нужны|хочу|следует)\s+(?:мне\s+)?(?:искать|поиск|поисковик|интернет|веб|web)|не\s+(?:ищи|ищите|искать|заходи|заходить|открывай|открывать|используй|использовать|проверяй|проверять).{0,48}(?:поиск|поисковик|интернет|веб|web|search)|без\s+(?:поиска|поисковика|интернета|веба|web)|не\s+нужн(?:ы|а|о)?\s+(?:мне\s+)?(?:актуальн(?:ые|ая|ое)?\s+)?результат(?:ы|ов)?\s+поиск)/iu.test(
    normalized,
  );
}

function wantsWeb(text: string) {
  if (forbidsWeb(text)) return false;

  const explicitWebAction = /(найди(?:\s+мне)?(?:\s+в\s+интернете)?|поищи|поиск(?:ать|и)?\s+(?:в\s+)?(?:интернете|вебе|web)|загугли|открой\s+(?:сайт|страниц|https?:\/\/)|зайди\s+на\s+(?:сайт|страниц|https?:\/\/)|прочитай\s+(?:сайт|страниц)|посмотри\s+(?:в\s+интернете|на\s+сайте|на\s+странице)|проверь\s+(?:в\s+интернете|сайт|страниц|источник)|исследуй\s+(?:в\s+интернете|источник)|\bresearch\b|\bsearch\b)/iu;
  if (explicitWebAction.test(text)) return true;

  const freshnessNeeded = /(погода.{0,30}(?:сегодня|сейчас|завтра)|(?:сегодня|сейчас|завтра).{0,30}погода|курс.{0,30}(?:сегодня|сейчас|текущ)|(?:сегодня|сейчас|текущ).{0,30}курс|цен[аы].{0,30}(?:сегодня|сейчас|текущ)|(?:сегодня|сейчас|текущ).{0,30}цен[аы]|последн(?:ие|яя|ий).{0,40}(?:новост|обновлен|верси|результат)|свеж(?:ие|ая|ий).{0,30}(?:новост|данн|информац)|что\s+(?:произошло|случилось)\s+сегодня|кто\s+сейчас\s+(?:президент|чемпион|лидер)|bitcoin|\bbtc\b)/iu;
  return freshnessNeeded.test(text);
}

function wantsSandbox(text: string) {
  return /(запусти.*код|выполни.*код|испытай.*код|протестируй.*код|проверь.*код.*запусти|python|питон|песочниц|sandbox|вычисли|посчитай.*код|запусти.*скрипт|выполни.*скрипт)/iu.test(
    text,
  );
}

export function selectBrainMode(query: string, repositoryRead: boolean): BrainMode {
  if (repositoryRead) return "repository";
  const web = wantsWeb(query);
  const sandbox = wantsSandbox(query);
  if (web && sandbox) return "agentic";
  if (web) return "research";
  if (sandbox) return "sandbox";
  return "chat";
}

function normalizeTools(data: BrainResponseData | null) {
  const tools = data?.choices?.[0]?.message?.executed_tools || [];
  return tools.map((tool) => `${tool.type || ""}:${tool.name || ""}`.toLowerCase());
}

function extractSources(data: BrainResponseData | null) {
  const tools = data?.choices?.[0]?.message?.executed_tools || [];
  const unique = new Map<string, { title: string; url: string }>();
  for (const tool of tools) {
    for (const result of tool.search_results?.results || []) {
      if (!result.url) continue;
      unique.set(result.url, {
        title: result.title || result.url,
        url: result.url,
      });
    }
  }
  return [...unique.values()].slice(0, 12);
}

async function gatewayToken() {
  const configured = process.env.AI_GATEWAY_API_KEY?.trim();
  if (configured) return configured;
  return getVercelOidcToken({ expirationBufferMs: 2 * 60_000 });
}

async function gatewayRequest(args: {
  systemContent: string;
  history: BrainMessage[];
  maxCompletion: number;
}) {
  const started = Date.now();
  try {
    const token = await gatewayToken();
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        messages: [
          { role: "system", content: args.systemContent },
          ...args.history,
        ],
        max_completion_tokens: args.maxCompletion,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as BrainResponseData | null;
    const normalized = new Response(JSON.stringify(data || {}), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "x-khasroy-ai-provider": "gateway",
      },
    });
    const latencyMs = Date.now() - started;
    if (response.ok && data?.choices?.[0]?.message?.content) {
      recordProviderSuccess("vercel-gateway", response.status, latencyMs);
    } else {
      recordProviderFailure("vercel-gateway", {
        status: response.status,
        error: data?.error?.message,
        latencyMs,
      });
    }

    return {
      response: normalized,
      data,
      provider: "groq" as const,
      model: data?.model || GATEWAY_MODEL,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    recordProviderFailure("vercel-gateway", { error, latencyMs });
    console.error("Khasroy AI Gateway request failed", error);
    const data: BrainResponseData = {
      error: {
        message: "AI Gateway unavailable",
        type: "gateway_unavailable",
        code: "gateway_unavailable",
      },
    };
    return {
      response: new Response(JSON.stringify(data), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "x-khasroy-ai-provider": "gateway",
        },
      }),
      data,
      provider: "groq" as const,
      model: GATEWAY_MODEL,
      latencyMs,
    };
  }
}

async function groqRequest(args: {
  apiKey: string;
  model: string;
  systemContent: string;
  history: BrainMessage[];
  maxCompletion: number;
  reasoning?: "low" | "medium";
  compoundTools?: string[];
}) {
  const started = Date.now();
  if (!args.apiKey) {
    const data: BrainResponseData = {
      error: { message: "Groq key missing", type: "config", code: "missing_key" },
    };
    return {
      response: new Response(JSON.stringify(data), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      data,
      latencyMs: 0,
    };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: "system", content: args.systemContent }, ...args.history],
    max_completion_tokens: args.maxCompletion,
    stream: false,
  };
  if (args.reasoning && !args.model.startsWith("groq/compound")) {
    body.reasoning_effort = args.reasoning;
  }
  if (args.compoundTools?.length) {
    body.compound_custom = { tools: { enabled_tools: args.compoundTools } };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      ...(args.model.startsWith("groq/compound")
        ? { "Groq-Model-Version": "latest" }
        : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  }).catch(() => null);

  const latencyMs = Date.now() - started;
  if (!response) {
    recordProviderFailure("groq", { error: "network_error", latencyMs });
    const data: BrainResponseData = {
      error: { message: "Groq unavailable", type: "network", code: "network_error" },
    };
    return {
      response: new Response(JSON.stringify(data), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      data,
      latencyMs,
    };
  }

  const data = (await response.json().catch(() => null)) as BrainResponseData | null;
  if (response.ok && data?.choices?.[0]?.message?.content) {
    recordProviderSuccess("groq", response.status, latencyMs);
  } else {
    recordProviderFailure("groq", {
      status: response.status,
      error: data?.error?.message,
      latencyMs,
    });
  }
  return { response, data, latencyMs };
}

type TeacherProfile = "fast" | "reasoning" | "code" | "long-context" | "research";
type TextTeacher = "self-hosted" | "groq" | ExternalTeacher | "vercel-gateway";

function teacherProfile(query: string, mode: BrainMode): TeacherProfile {
  if (mode === "research") return "research";
  if (mode === "repository") return "code";
  const normalized = query.toLowerCase();
  if (query.length > 7_000 || /(длинн|документ|контекст|книг|pdf|суммариз|summary)/iu.test(normalized)) {
    return "long-context";
  }
  if (/(код|typescript|javascript|python|react|next\.?js|архитектур|api|sql|github|верстк|програм)/iu.test(normalized)) {
    return "code";
  }
  if (/(проанализ|сравни|докажи|почему|логик|рассужд|план|стратег|сложн|математ)/iu.test(normalized)) {
    return "reasoning";
  }
  return "fast";
}

const TEACHER_BASE_SCORE: Record<TeacherProfile, Record<TextTeacher, number>> = {
  fast: {
    "self-hosted": 104,
    groq: 100,
    openai: 88,
    gemini: 86,
    kimi: 90,
    "vercel-gateway": 65,
  },
  reasoning: {
    "self-hosted": 92,
    groq: 84,
    openai: 105,
    gemini: 98,
    kimi: 96,
    "vercel-gateway": 70,
  },
  code: {
    "self-hosted": 90,
    groq: 86,
    openai: 108,
    gemini: 97,
    kimi: 99,
    "vercel-gateway": 72,
  },
  "long-context": {
    "self-hosted": 85,
    groq: 78,
    openai: 96,
    gemini: 108,
    kimi: 103,
    "vercel-gateway": 70,
  },
  research: {
    "self-hosted": 88,
    groq: 86,
    openai: 102,
    gemini: 106,
    kimi: 96,
    "vercel-gateway": 72,
  },
};

function teacherConfigured(
  teacher: TextTeacher,
  args: { apiKey: string; selfHostedOnline: boolean },
) {
  if (teacher === "self-hosted") return args.selfHostedOnline;
  if (teacher === "groq") return Boolean(args.apiKey);
  if (teacher === "vercel-gateway") {
    return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL);
  }
  return externalTeacherConfigured(teacher);
}

function teacherScore(teacher: TextTeacher, profile: TeacherProfile) {
  const snapshot = providerHealthSnapshot() as Record<
    string,
    {
      successes?: number;
      failures?: number;
      consecutiveFailures?: number;
      averageLatencyMs?: number | null;
    }
  >;
  const health = snapshot[teacher];
  const successes = Number(health?.successes) || 0;
  const failures = Number(health?.failures) || 0;
  const total = successes + failures;
  const reliability = total ? (successes / total - 0.5) * 20 : 0;
  const failurePenalty = (Number(health?.consecutiveFailures) || 0) * 12;
  const averageLatency = Number(health?.averageLatencyMs) || 0;
  const latencyPenalty = averageLatency ? Math.min(averageLatency / 2_500, 8) : 0;
  return TEACHER_BASE_SCORE[profile][teacher] + reliability - failurePenalty - latencyPenalty;
}

function rankedTeachers(args: {
  query: string;
  mode: BrainMode;
  apiKey: string;
  selfHostedOnline: boolean;
}) {
  const profile = teacherProfile(args.query, args.mode);
  const all: TextTeacher[] = [
    "self-hosted",
    "groq",
    "openai",
    "gemini",
    "kimi",
    "vercel-gateway",
  ];
  return all
    .filter((teacher) => teacherConfigured(teacher, args))
    .filter((teacher) => canAttemptProvider(teacher as SurvivalProvider))
    .sort((a, b) => teacherScore(b, profile) - teacherScore(a, profile));
}

async function preferredTextRequest(args: {
  apiKey: string;
  fallbackModel: string;
  systemContent: string;
  history: BrainMessage[];
  maxCompletion: number;
  reasoning?: "low" | "medium";
  selfHostedOnline: boolean;
  query: string;
  mode: BrainMode;
}) {
  const teachers = rankedTeachers({
    query: args.query,
    mode: args.mode,
    apiKey: args.apiKey,
    selfHostedOnline: args.selfHostedOnline,
  }).slice(0, MAX_TEACHER_ATTEMPTS);

  let last:
    | {
        response: Response;
        data: BrainResponseData | null;
        provider: BrainProvider;
        model: string;
      }
    | null = null;

  for (const teacher of teachers) {
    if (teacher === "self-hosted") {
      const started = Date.now();
      const local = await selfHostedChat({
        messages: [
          { role: "system", content: args.systemContent },
          ...args.history,
        ],
        maxTokens: args.maxCompletion,
      });
      const latencyMs = Date.now() - started;
      if (local?.response.ok && local.data?.choices?.[0]?.message?.content) {
        recordProviderSuccess("self-hosted", local.response.status, latencyMs);
        const data: BrainResponseData = {
          model: local.model,
          choices: local.data.choices,
          error: local.data.error,
        };
        return {
          response: local.response,
          data,
          provider: "self-hosted" as const,
          model: local.model,
        };
      }
      recordProviderFailure("self-hosted", {
        status: local?.response.status,
        error: local?.data?.error?.message || "empty_response",
        latencyMs,
      });
      continue;
    }

    if (teacher === "groq") {
      const groq = await groqRequest({
        apiKey: args.apiKey,
        model: args.fallbackModel,
        systemContent: args.systemContent,
        history: args.history,
        maxCompletion: args.maxCompletion,
        reasoning: args.reasoning,
      });
      last = {
        response: groq.response,
        data: groq.data,
        provider: "groq",
        model: groq.data?.model || args.fallbackModel,
      };
      if (groq.response.ok && groq.data?.choices?.[0]?.message?.content) return last;
      continue;
    }

    if (teacher === "vercel-gateway") {
      const gateway = await gatewayRequest({
        systemContent: args.systemContent,
        history: args.history,
        maxCompletion: args.maxCompletion,
      });
      last = {
        response: gateway.response,
        data: gateway.data,
        provider: "groq",
        model: gateway.model,
      };
      if (gateway.response.ok && gateway.data?.choices?.[0]?.message?.content) return last;
      continue;
    }

    const external = await runExternalTeacher(teacher, {
      systemContent: args.systemContent,
      history: args.history,
      maxCompletion: args.maxCompletion,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    const survivalTeacher = teacher as SurvivalProvider;
    if (external.response.ok && external.data?.choices?.[0]?.message?.content) {
      recordProviderSuccess(survivalTeacher, external.response.status, external.latencyMs);
      return {
        response: external.response,
        data: external.data,
        provider: teacher,
        model: external.model,
      };
    }
    recordProviderFailure(survivalTeacher, {
      status: external.response.status,
      error: external.data?.error?.message,
      latencyMs: external.latencyMs,
    });
    last = {
      response: external.response,
      data: external.data,
      provider: teacher,
      model: external.model,
    };
  }

  if (last) return last;

  const groq = await groqRequest({
    apiKey: args.apiKey,
    model: args.fallbackModel,
    systemContent: args.systemContent,
    history: args.history,
    maxCompletion: args.maxCompletion,
    reasoning: args.reasoning,
  });
  return {
    ...groq,
    provider: "groq" as const,
    model: groq.data?.model || args.fallbackModel,
  };
}

function directSources(
  sources: Array<{ title: string; url: string; snippet: string }>,
) {
  return sources.map(({ title, url }) => ({ title, url }));
}

export async function runBrain(args: {
  apiKey: string;
  defaultModel: string;
  systemContent: string;
  history: BrainMessage[];
  query: string;
  repositoryRead: boolean;
}): Promise<BrainRun> {
  const mode = selectBrainMode(args.query, args.repositoryRead);
  const selfHostedState = await selfHostedHealth().catch(() => ({
    configured: false,
    online: false,
    model: null as string | null,
  }));
  const selfHostedOnline = selfHostedState.online === true;

  if (mode === "research") {
    try {
      const searched = await searchWebDirect(args.query, 6);
      const sources = directSources(searched.sources);
      const result = await preferredTextRequest({
        apiKey: args.apiKey,
        fallbackModel: args.defaultModel,
        systemContent: `${args.systemContent.slice(0, 7_000)}\n\nVERIFIED SERVER WEB SEARCH RESULTS\n${searched.context.slice(0, 8_000)}\n\nОтветь на запрос только по этим реальным результатам для актуальных веб-фактов. Перечисли источники.`,
        history: args.history.slice(-8),
        maxCompletion: 1000,
        reasoning: "low",
        selfHostedOnline,
        query: args.query,
        mode,
      });
      if (result.response.ok && result.data?.choices?.[0]?.message?.content) {
        return {
          response: result.response,
          data: result.data,
          provider: result.provider,
          model: result.model,
          mode,
          toolsUsed: ["direct_web_search:server"],
          sources,
          webToolForced: true,
        };
      }
    } catch (error) {
      console.error("Khasroy direct research failed", error);
    }

    const compound = await groqRequest({
      apiKey: args.apiKey,
      model: "groq/compound-mini",
      systemContent: `${args.systemContent.slice(0, 4_000)}\n\nWEB RESEARCH MODE: используй web_search и отвечай по найденным источникам.`,
      history: [{ role: "user", content: args.query.slice(0, 2_500) }],
      maxCompletion: 900,
      compoundTools: ["web_search"],
    });

    return {
      response: compound.response,
      data: compound.data,
      provider: "groq",
      model: compound.data?.model || "groq/compound-mini",
      mode,
      toolsUsed: normalizeTools(compound.data),
      sources: extractSources(compound.data),
      webToolForced: true,
    };
  }

  if (mode === "chat" || mode === "repository") {
    const systemContent = mode === "repository"
      ? args.systemContent.slice(0, 18_000)
      : args.systemContent;
    const history = mode === "repository"
      ? args.history.slice(-6)
      : args.history.slice(-16);
    const result = await preferredTextRequest({
      apiKey: args.apiKey,
      fallbackModel: args.defaultModel,
      systemContent,
      history,
      maxCompletion: mode === "repository" ? 1200 : 2200,
      reasoning: mode === "repository" ? "low" : "medium",
      selfHostedOnline,
      query: args.query,
      mode,
    });

    return {
      response: result.response,
      data: result.data,
      provider: result.provider,
      model: result.model,
      mode,
      toolsUsed: [],
      sources: [],
      webToolForced: false,
    };
  }

  const model = mode === "sandbox" ? "groq/compound-mini" : "groq/compound";
  const tools = mode === "sandbox"
    ? ["code_interpreter"]
    : ["web_search", "visit_website", "code_interpreter"];
  const compound = await groqRequest({
    apiKey: args.apiKey,
    model,
    systemContent: `${args.systemContent.slice(0, 7_000)}\n\n${
      mode === "sandbox"
        ? "SANDBOX MODE: используй безопасный code interpreter только если он реально доступен."
        : "AGENTIC MODE: используй веб-поиск и code interpreter только когда они нужны."
    }`,
    history: args.history.slice(-6),
    maxCompletion: mode === "sandbox" ? 1200 : 1400,
    compoundTools: tools,
  });

  if (compound.response.ok && compound.data?.choices?.[0]?.message?.content) {
    return {
      response: compound.response,
      data: compound.data,
      provider: "groq",
      model: compound.data.model || model,
      mode,
      toolsUsed: normalizeTools(compound.data),
      sources: extractSources(compound.data),
      webToolForced: false,
    };
  }

  const fallback = await preferredTextRequest({
    apiKey: args.apiKey,
    fallbackModel: args.defaultModel,
    systemContent: `${args.systemContent.slice(0, 7_000)}\n\nИнструментальный провайдер недоступен. Не утверждай, что веб-поиск или выполнение кода состоялись. Дай полезный ответ только в пределах доступного контекста.`,
    history: args.history.slice(-6),
    maxCompletion: 900,
    reasoning: "low",
    selfHostedOnline,
    query: args.query,
    mode,
  });

  return {
    response: fallback.response,
    data: fallback.data,
    provider: fallback.provider,
    model: fallback.model,
    mode,
    toolsUsed: [],
    sources: [],
    webToolForced: false,
  };
}
