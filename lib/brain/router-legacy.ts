import { getVercelOidcToken } from "@vercel/oidc";
import { searchWebDirect } from "@/lib/server-web";
import {
  selfHostedChat,
  selfHostedHealth,
} from "@/lib/brain/providers/self-hosted";

export type BrainMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BrainMode = "chat" | "repository" | "research" | "sandbox" | "agentic";
export type BrainProvider = "self-hosted" | "groq";

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
      signal: AbortSignal.timeout(40_000),
    });

    const data = (await response.json().catch(() => null)) as BrainResponseData | null;
    const normalized = new Response(JSON.stringify(data || {}), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "x-khasroy-ai-provider": "gateway",
      },
    });

    return {
      response: normalized,
      data,
      provider: "groq" as const,
      model: data?.model || GATEWAY_MODEL,
    };
  } catch (error) {
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
    signal: AbortSignal.timeout(35_000),
  }).catch(() => null);

  if (!response) {
    const data: BrainResponseData = {
      error: { message: "Groq unavailable", type: "network", code: "network_error" },
    };
    return {
      response: new Response(JSON.stringify(data), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
      data,
    };
  }

  const data = (await response.json().catch(() => null)) as BrainResponseData | null;
  return { response, data };
}

async function preferredTextRequest(args: {
  apiKey: string;
  fallbackModel: string;
  systemContent: string;
  history: BrainMessage[];
  maxCompletion: number;
  reasoning?: "low" | "medium";
  selfHostedOnline: boolean;
}) {
  if (args.selfHostedOnline) {
    const local = await selfHostedChat({
      messages: [
        { role: "system", content: args.systemContent },
        ...args.history,
      ],
      maxTokens: args.maxCompletion,
    });
    if (local?.response.ok && local.data?.choices?.[0]?.message?.content) {
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
  }

  const groq = await groqRequest({
    apiKey: args.apiKey,
    model: args.fallbackModel,
    systemContent: args.systemContent,
    history: args.history,
    maxCompletion: args.maxCompletion,
    reasoning: args.reasoning,
  });
  if (groq.response.ok && groq.data?.choices?.[0]?.message?.content) {
    return {
      ...groq,
      provider: "groq" as const,
      model: groq.data.model || args.fallbackModel,
    };
  }

  const gateway = await gatewayRequest({
    systemContent: args.systemContent,
    history: args.history,
    maxCompletion: args.maxCompletion,
  });
  if (gateway.response.ok && gateway.data?.choices?.[0]?.message?.content) {
    return gateway;
  }

  return gateway.response.status < 500 ? gateway : {
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
