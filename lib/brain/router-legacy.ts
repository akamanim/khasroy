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

type ResponsesAnnotation = {
  type?: string;
  url?: string;
  title?: string;
  url_citation?: {
    url?: string;
    title?: string;
  };
};

type ResponsesContent = {
  type?: string;
  text?: string;
  annotations?: ResponsesAnnotation[];
};

type ResponsesOutput = {
  type?: string;
  name?: string;
  role?: string;
  content?: ResponsesContent[];
};

type GroqResponsesData = {
  model?: string;
  status?: string;
  output?: ResponsesOutput[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  } | null;
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

function wantsWeb(text: string) {
  return /(https?:\/\/|найди|поищи|поиск|интернет|в интернете|сайт|страниц|прочитай.*сайт|открой.*сайт|актуальн|сегодня|сейчас|последн|новост|исследуй|research|search|проверь.*источник|курс.*битко|цена.*битко|bitcoin|btc)/iu.test(
    text,
  );
}

function wantsSandbox(text: string) {
  return /(запусти.*код|выполни.*код|испытай.*код|протестируй.*код|проверь.*код.*запусти|python|питон|песочниц|sandbox|вычисли|посчитай.*код|запусти.*скрипт|выполни.*скрипт)/iu.test(
    text,
  );
}

function extractUrls(text: string) {
  return text.match(/https?:\/\/[^\s)\]}>"']+/giu) || [];
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

function responseText(data: GroqResponsesData | null) {
  const chunks: string[] = [];
  for (const item of data?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function responseSources(data: GroqResponsesData | null) {
  const unique = new Map<string, { title: string; url: string }>();

  for (const item of data?.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        const url = annotation.url_citation?.url || annotation.url;
        if (!url) continue;
        unique.set(url, {
          title: annotation.url_citation?.title || annotation.title || url,
          url,
        });
      }
    }
  }

  return [...unique.values()].slice(0, 12);
}

function responseUsedBrowser(data: GroqResponsesData | null) {
  return (data?.output || []).some((item) =>
    /browser|search/i.test(`${item.type || ""}:${item.name || ""}`),
  );
}

function toChatShape(data: GroqResponsesData | null): BrainResponseData | null {
  if (!data) return null;
  const content = responseText(data);
  return {
    model: data.model,
    choices: content
      ? [
          {
            message: {
              content,
              executed_tools: responseUsedBrowser(data)
                ? [{ type: "browser_search", name: "responses_api" }]
                : [],
            },
          },
        ]
      : [],
    error: data.error
      ? {
          message: data.error.message,
          type: data.error.type,
          code: data.error.code,
        }
      : undefined,
  };
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
    body.compound_custom = {
      tools: { enabled_tools: args.compoundTools },
    };
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
  });

  const data = (await response.json().catch(() => null)) as BrainResponseData | null;
  return { response, data };
}

async function groqResponsesWeb(args: {
  apiKey: string;
  query: string;
  systemContent: string;
}) {
  const response = await fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      instructions: `${args.systemContent.slice(0, 3_000)}\n\nWEB MODE: обязательно используй browser_search. Дай актуальный ответ и укажи реальные источники.`,
      input: args.query.slice(0, 2_500),
      tool_choice: "required",
      tools: [{ type: "browser_search" }],
      reasoning: { effort: "low" },
      max_output_tokens: 900,
    }),
  });

  const raw = (await response.json().catch(() => null)) as GroqResponsesData | null;
  return {
    response,
    data: toChatShape(raw),
    raw,
    sources: responseSources(raw),
    usedBrowser: response.ok && responseUsedBrowser(raw),
  };
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

  return {
    ...groq,
    provider: "groq" as const,
    model: groq.data?.model || args.fallbackModel,
  };
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
    // Only a genuinely online GPU may enter the self-hosted research branch.
    if (selfHostedOnline) {
      try {
        const searched = await searchWebDirect(args.query, 5);
        const directSources = searched.sources.map(({ title, url }) => ({ title, url }));
        const local = await selfHostedChat({
          messages: [
            {
              role: "system",
              content: `${args.systemContent.slice(0, 3_500)}\n\nSERVER WEB SEARCH RESULTS\n${searched.context.slice(0, 6_000)}\n\nОтветь только по этим реальным результатам и перечисли источники.`,
            },
            { role: "user", content: args.query.slice(0, 2_500) },
          ],
          maxTokens: 900,
        });

        if (local?.response.ok && local.data?.choices?.[0]?.message?.content) {
          return {
            response: local.response,
            data: {
              model: local.model,
              choices: local.data.choices,
              error: local.data.error,
            },
            provider: "self-hosted",
            model: local.model,
            mode,
            toolsUsed: ["direct_web_search:server"],
            sources: directSources,
            webToolForced: true,
          };
        }
      } catch (error) {
        console.error("Khasroy self-hosted research failed", error);
      }
    }

    const web = await groqResponsesWeb({
      apiKey: args.apiKey,
      query: args.query,
      systemContent: args.systemContent,
    });

    if (web.response.ok && web.data?.choices?.[0]?.message?.content) {
      return {
        response: web.response,
        data: web.data,
        provider: "groq",
        model: web.raw?.model || "openai/gpt-oss-20b",
        mode,
        toolsUsed: ["browser_search:responses_api"],
        sources: web.sources,
        webToolForced: true,
      };
    }

    let compound = await groqRequest({
      apiKey: args.apiKey,
      model: "groq/compound-mini",
      systemContent: `${args.systemContent.slice(0, 4_000)}\n\nWEB RESEARCH MODE: используй web_search и отвечай по найденным источникам.`,
      history: [{ role: "user", content: args.query.slice(0, 2_500) }],
      maxCompletion: 900,
      compoundTools: extractUrls(args.query).length ? ["visit_website"] : ["web_search"],
    });

    if (compound.response.ok && compound.data?.choices?.[0]?.message?.content) {
      return {
        response: compound.response,
        data: compound.data,
        provider: "groq",
        model: compound.data.model || "groq/compound-mini",
        mode,
        toolsUsed: normalizeTools(compound.data),
        sources: extractSources(compound.data),
        webToolForced: true,
      };
    }

    try {
      const searched = await searchWebDirect(args.query, 5);
      const directSources = searched.sources.map(({ title, url }) => ({ title, url }));
      const direct = await preferredTextRequest({
        apiKey: args.apiKey,
        fallbackModel: args.defaultModel,
        systemContent: `${args.systemContent.slice(0, 2_500)}\n\nSERVER WEB SEARCH RESULTS\n${searched.context.slice(0, 4_500)}\n\nОтветь только по этим реальным результатам и перечисли источники.`,
        history: [{ role: "user", content: args.query.slice(0, 2_000) }],
        maxCompletion: 700,
        reasoning: "low",
        selfHostedOnline,
      });

      if (direct.response.ok && direct.data?.choices?.[0]?.message?.content) {
        return {
          response: direct.response,
          data: direct.data,
          provider: direct.provider,
          model: direct.model,
          mode,
          toolsUsed: ["direct_web_search:server"],
          sources: directSources,
          webToolForced: true,
        };
      }

      compound = direct;
    } catch (error) {
      console.error("Khasroy direct web fallback failed", error);
    }

    return {
      response: compound.response,
      data: compound.data,
      provider: "groq",
      model: compound.data?.model || "groq/compound-mini",
      mode,
      toolsUsed: [],
      sources: [],
      webToolForced: false,
    };
  }

  if (mode === "chat" || mode === "repository") {
    const systemContent = mode === "repository"
      ? args.systemContent.slice(0, 18_000)
      : args.systemContent;
    const history = mode === "repository" ? args.history.slice(-6) : args.history.slice(-16);
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

  // Sandbox/agentic temporarily use Groq's managed code interpreter.
  const model = mode === "sandbox" ? "groq/compound-mini" : "groq/compound";
  const tools = mode === "sandbox"
    ? ["code_interpreter"]
    : ["web_search", "visit_website", "code_interpreter"];
  const systemContent = `${args.systemContent.slice(0, 7_000)}\n\n${
    mode === "sandbox"
      ? "SANDBOX MODE: используй безопасный облачный code interpreter. Не утверждай, что код выполнен, если инструмент не запускался."
      : "AGENTIC MODE: используй веб-поиск и code interpreter только когда они нужны. Чётко отличай найденные факты от вычисленных результатов."
  }`;

  const result = await groqRequest({
    apiKey: args.apiKey,
    model,
    systemContent,
    history: args.history.slice(-6),
    maxCompletion: mode === "sandbox" ? 1200 : 1400,
    compoundTools: tools,
  });

  return {
    response: result.response,
    data: result.data,
    provider: "groq",
    model: result.data?.model || model,
    mode,
    toolsUsed: normalizeTools(result.data),
    sources: extractSources(result.data),
    webToolForced: false,
  };
}

export function usedWebTool(run: BrainRun) {
  return (
    run.webToolForced ||
    run.sources.length > 0 ||
    run.toolsUsed.some((tool) => /search|visit|browser/.test(tool))
  );
}

export function usedCodeInterpreter(run: BrainRun) {
  return run.toolsUsed.some((tool) => /python|code|interpreter/.test(tool));
}
