import { searchWebDirect } from "@/lib/server-web";

export type BrainMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BrainMode = "chat" | "repository" | "research" | "sandbox" | "agentic";

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
  provider: "groq";
  model: string;
  mode: BrainMode;
  toolsUsed: string[];
  sources: Array<{ title: string; url: string }>;
  webToolForced: boolean;
};

function wantsWeb(text: string) {
  return /(https?:\/\/|найди|поищи|поиск|интернет|в интернете|сайт|страниц|прочитай.*сайт|открой.*сайт|актуальн|сегодня|сейчас|последн|новост|исследуй|research|search|проверь.*источник)/iu.test(
    text,
  );
}

function wantsSandbox(text: string) {
  return /(запусти.*код|выполни.*код|испытай.*код|протестируй.*код|проверь.*код.*запусти|python|питон|песочниц|sandbox|вычисли|посчитай.*код|запусти.*скрипт|выполни.*скрипт)/iu.test(
    text,
  );
}

function wantsDeepResearch(text: string) {
  return /(исследуй|глубоко|подробн.*исслед|сравни.*источник|несколько.*источник|deep research)/iu.test(
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

async function groqRequest(args: {
  apiKey: string;
  model: string;
  systemContent: string;
  history: BrainMessage[];
  maxCompletion: number;
  reasoning?: "low" | "medium";
  compoundTools?: string[];
  nativeTools?: string[];
  toolChoice?: "required" | "auto";
}) {
  const body: Record<string, unknown> = {
    model: args.model,
    messages: [{ role: "system", content: args.systemContent }, ...args.history],
    max_completion_tokens: args.maxCompletion,
    stream: false,
    citation_options: "enabled",
  };

  if (args.reasoning && !args.model.startsWith("groq/compound")) {
    body.reasoning_effort = args.reasoning;
  }

  if (args.compoundTools?.length) {
    body.compound_custom = {
      tools: { enabled_tools: args.compoundTools },
    };
  }

  if (args.nativeTools?.length) {
    body.tools = args.nativeTools.map((type) => ({ type }));
    body.tool_choice = args.toolChoice || "required";
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

export async function runBrain(args: {
  apiKey: string;
  defaultModel: string;
  systemContent: string;
  history: BrainMessage[];
  query: string;
  repositoryRead: boolean;
}): Promise<BrainRun> {
  const mode = selectBrainMode(args.query, args.repositoryRead);

  let model = args.defaultModel;
  let maxCompletion = 2200;
  let reasoning: "low" | "medium" | undefined = "medium";
  let compoundTools: string[] | undefined;
  let history = args.history.slice(-16);
  let systemContent = args.systemContent;
  let webToolForced = false;
  let directSources: Array<{ title: string; url: string }> = [];

  if (mode === "repository") {
    maxCompletion = 1100;
    reasoning = "low";
    history = args.history.slice(-6);
  } else if (mode === "research") {
    const urls = extractUrls(args.query);
    const deep = wantsDeepResearch(args.query);
    model = deep ? "groq/compound" : "groq/compound-mini";
    compoundTools = urls.length ? ["visit_website"] : ["web_search"];
    maxCompletion = deep ? 1600 : 1000;
    reasoning = undefined;
    history = args.history.slice(-6);
    systemContent = args.systemContent.slice(0, 10_000);
    systemContent += "\n\nWEB RESEARCH MODE: обязательно используй разрешённый веб-инструмент, опирайся на свежие источники и не выдавай сведения из памяти модели за найденные в интернете.";
  } else if (mode === "sandbox") {
    model = "groq/compound-mini";
    compoundTools = ["code_interpreter"];
    maxCompletion = 1200;
    reasoning = undefined;
    history = args.history.slice(-8);
    systemContent += "\n\nSANDBOX MODE: если задача требует вычисления или проверки кода, используй безопасный облачный code interpreter. Не утверждай, что код выполнен, если инструмент не запускался.";
  } else if (mode === "agentic") {
    model = "groq/compound";
    compoundTools = ["web_search", "visit_website", "code_interpreter"];
    maxCompletion = 1600;
    reasoning = undefined;
    history = args.history.slice(-6);
    systemContent = args.systemContent.slice(0, 10_000);
    systemContent += "\n\nAGENTIC MODE: при необходимости используй веб-поиск, посещение страниц и безопасный code interpreter. Чётко отличай найденные факты от вычисленных результатов.";
  }

  let result = await groqRequest({
    apiKey: args.apiKey,
    model,
    systemContent,
    history,
    maxCompletion,
    reasoning,
    compoundTools,
  });

  // First internet failover: native browser search on GPT-OSS.
  if (!result.response.ok && (mode === "research" || mode === "agentic")) {
    const browserModel = args.defaultModel.startsWith("openai/gpt-oss")
      ? args.defaultModel
      : "openai/gpt-oss-120b";

    result = await groqRequest({
      apiKey: args.apiKey,
      model: browserModel,
      systemContent: `${args.systemContent.slice(0, 6_500)}\n\nBROWSER SEARCH FALLBACK: обязательно используй browser_search и отвечай только на основе реально найденных веб-источников.`,
      history: args.history.slice(-4),
      maxCompletion: 800,
      reasoning: "low",
      nativeTools: ["browser_search"],
      toolChoice: "required",
    });

    model = browserModel;
    webToolForced = result.response.ok;
  }

  // Second internet failover: independent server-side search. This does not
  // depend on Groq's web-tool entitlement. Real search snippets and URLs are
  // collected first, then the normal GPT-OSS model synthesizes the answer.
  if (!result.response.ok && (mode === "research" || mode === "agentic")) {
    try {
      const searched = await searchWebDirect(args.query, 6);
      directSources = searched.sources.map(({ title, url }) => ({ title, url }));
      const directContext = `\n\nSERVER WEB SEARCH RESULTS\nЭто реальные результаты серверного веб-поиска. Используй только факты, которые видны в этих результатах. Для утверждений о текущих данных укажи названия источников и URL.\n\n${searched.context}`;

      result = await groqRequest({
        apiKey: args.apiKey,
        model: args.defaultModel,
        systemContent: `${args.systemContent.slice(0, 5_500)}${directContext}`,
        history: args.history.slice(-3),
        maxCompletion: 800,
        reasoning: "low",
      });

      model = args.defaultModel;
      webToolForced = result.response.ok && directSources.length > 0;
    } catch (error) {
      console.error("Khasroy direct web fallback failed", error);
    }
  }

  // Repository mode can be large on the free standalone model. Retry once with
  // a compact real excerpt instead of failing the whole conversation.
  if (!result.response.ok && mode === "repository" && result.response.status !== 429) {
    result = await groqRequest({
      apiKey: args.apiKey,
      model: args.defaultModel,
      systemContent: systemContent.slice(0, 12_000),
      history: args.history.slice(-4),
      maxCompletion: 800,
      reasoning: "low",
    });
    model = args.defaultModel;
  }

  const toolsUsed = normalizeTools(result.data);
  if (webToolForced && directSources.length) {
    toolsUsed.push("direct_web_search:server");
  } else if (webToolForced && !toolsUsed.some((tool) => tool.includes("browser_search"))) {
    toolsUsed.push("browser_search:required");
  }

  const extractedSources = extractSources(result.data);

  return {
    response: result.response,
    data: result.data,
    provider: "groq",
    model: result.data?.model || model,
    mode,
    toolsUsed,
    sources: directSources.length ? directSources : extractedSources,
    webToolForced,
  };
}

export function usedWebTool(run: BrainRun) {
  return run.webToolForced || run.sources.length > 0 || run.toolsUsed.some((tool) => /search|visit|browser/.test(tool));
}

export function usedCodeInterpreter(run: BrainRun) {
  return run.toolsUsed.some((tool) => /python|code|interpreter/.test(tool));
}
