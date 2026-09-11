import {
  runBrain as runLegacyBrain,
  selectBrainMode,
  type BrainMessage,
  type BrainMode,
  type BrainResponseData,
} from "@/lib/brain/router-legacy";
import { searchWebDirect } from "@/lib/server-web";
import {
  runCodeSandbox,
  type SandboxExecution,
  type SandboxLanguage,
} from "@/lib/server-sandbox";

export { selectBrainMode };
export type { BrainMessage, BrainMode, BrainResponseData };

export type BrainProvider = "self-hosted" | "groq";
export type BrainProviderDetail =
  | BrainProvider
  | "groq-fallback"
  | "gateway"
  | "vercel-sandbox";

export type BrainRun = {
  response: Response;
  data: BrainResponseData | null;
  provider: BrainProvider;
  providerDetail: BrainProviderDetail;
  model: string;
  mode: BrainMode;
  toolsUsed: string[];
  sources: Array<{ title: string; url: string }>;
  webToolForced: boolean;
};

type RunArgs = {
  apiKey: string;
  defaultModel: string;
  systemContent: string;
  history: BrainMessage[];
  query: string;
  repositoryRead: boolean;
};

type SandboxPlan = {
  language: SandboxLanguage;
  code: string;
  purpose: string;
};

const TEXT_ONLY_QUERY =
  "Сформируй итоговый ответ только по переданному контексту. Не запускай веб-поиск и код.";

function observedProvider(response: Response, fallback: string): BrainProviderDetail {
  const marked = response.headers.get("x-khasroy-ai-provider");
  if (marked === "gateway") return "gateway";
  if (marked === "groq-fallback") return "groq-fallback";
  if (fallback === "self-hosted") return "self-hosted";
  return "groq";
}

function normalizeLegacy(
  run: Awaited<ReturnType<typeof runLegacyBrain>>,
  mode = run.mode,
): BrainRun {
  return {
    ...run,
    provider: run.provider,
    providerDetail: observedProvider(run.response, run.provider),
    mode,
  };
}

async function textOnly(args: RunArgs, options: {
  systemContent: string;
  history: BrainMessage[];
  maxHistory?: number;
}) {
  const run = await runLegacyBrain({
    apiKey: args.apiKey,
    defaultModel: args.defaultModel,
    systemContent: options.systemContent,
    history: options.history.slice(-(options.maxHistory || 8)),
    query: TEXT_ONLY_QUERY,
    repositoryRead: false,
  });
  return normalizeLegacy(run, "chat");
}

function directSources(
  sources: Array<{ title: string; url: string; snippet: string }>,
) {
  return sources.map(({ title, url }) => ({ title, url }));
}

function parseJsonObject(value: string) {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/u);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function normalizeLanguage(value: unknown): SandboxLanguage | null {
  if (typeof value !== "string") return null;
  const language = value.toLowerCase().trim();
  if (["python", "py", "python3"].includes(language)) return "python";
  if (["javascript", "js", "node", "nodejs"].includes(language)) {
    return "javascript";
  }
  return null;
}

function fencedPlan(query: string): SandboxPlan | null {
  const match = query.match(
    /```(python|py|python3|javascript|js|node|nodejs)\s*\n([\s\S]*?)```/iu,
  );
  if (!match) return null;
  const language = normalizeLanguage(match[1]);
  const code = match[2]?.trim() || "";
  if (!language || !code || code.length > 12_000) return null;
  return {
    language,
    code,
    purpose: "Выполнить код, явно переданный владельцем.",
  };
}

async function buildSandboxPlan(
  args: RunArgs,
  verifiedContext = "",
): Promise<SandboxPlan | null> {
  const explicit = fencedPlan(args.query);
  if (explicit) return explicit;

  const planner = await textOnly(args, {
    systemContent: `Ты — планировщик безопасного выполнения кода Хасроя.
Верни ТОЛЬКО валидный JSON без markdown:
{"language":"python|javascript","code":"...","purpose":"..."}.
Правила:
- выбери Python 3.13 или Node.js 24;
- только стандартная библиотека / встроенные модули;
- программа должна печатать полезный итог в stdout;
- сеть запрещена, не пытайся обращаться к интернету;
- не читай секреты, env и системные файлы;
- не запускай дочерние shell-команды;
- код должен быть коротким и решать именно задачу владельца;
- если передан VERIFIED SEARCH CONTEXT, используй его как данные и не выдумывай другие факты.`,
    history: [
      {
        role: "user",
        content: `${args.query.slice(0, 3_000)}${
          verifiedContext
            ? `\n\nVERIFIED SEARCH CONTEXT\n${verifiedContext.slice(0, 7_000)}`
            : ""
        }`,
      },
    ],
  });

  if (!planner.response.ok) return null;
  const content = planner.data?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(content);
  if (!parsed) return null;

  const language = normalizeLanguage(parsed.language);
  const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
  const purpose =
    typeof parsed.purpose === "string"
      ? parsed.purpose.trim().slice(0, 240)
      : "Выполнить вычисление в изолированной песочнице.";

  if (!language || !code || code.length > 12_000) return null;
  return { language, code, purpose };
}

function sandboxEvidence(plan: SandboxPlan, execution: SandboxExecution) {
  return [
    "VERIFIED VERCEL SANDBOX EXECUTION",
    `environment=Vercel Sandbox Firecracker`,
    `runtime=${execution.runtime}`,
    `network=deny-all`,
    `language=${execution.language}`,
    `exitCode=${execution.exitCode}`,
    `durationMs=${execution.durationMs}`,
    `purpose=${plan.purpose}`,
    "STDOUT:",
    execution.stdout || "(empty)",
    "STDERR:",
    execution.stderr || "(empty)",
  ].join("\n");
}

function syntheticSandboxRun(
  mode: BrainMode,
  execution: SandboxExecution,
  sources: Array<{ title: string; url: string }> = [],
): BrainRun {
  const content = execution.ok
    ? `Код реально выполнен в изолированной Vercel Sandbox (${execution.runtime}).\n\n${
        execution.stdout || "Команда завершилась без вывода."
      }`
    : `Код реально запускался в изолированной Vercel Sandbox, но завершился с exit code ${execution.exitCode}.\n\n${
        execution.stderr || execution.stdout || "Вывод отсутствует."
      }`;

  const data: BrainResponseData = {
    model: `vercel-sandbox/${execution.runtime}`,
    choices: [{ message: { content } }],
  };
  const response = new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-khasroy-ai-provider": "vercel-sandbox",
    },
  });

  return {
    response,
    data,
    provider: "groq",
    providerDetail: "vercel-sandbox",
    model: data.model || "vercel-sandbox",
    mode,
    toolsUsed: [`code_interpreter:vercel_sandbox`, `runtime:${execution.runtime}`],
    sources,
    webToolForced: sources.length > 0,
  };
}

async function answerAfterExecution(
  args: RunArgs,
  mode: "sandbox" | "agentic",
  plan: SandboxPlan,
  execution: SandboxExecution,
  searchContext = "",
  sources: Array<{ title: string; url: string }> = [],
): Promise<BrainRun> {
  const evidence = sandboxEvidence(plan, execution);
  const final = await textOnly(args, {
    systemContent: `${args.systemContent.slice(0, 8_000)}

${searchContext ? `VERIFIED SERVER SEARCH RESULTS\n${searchContext.slice(0, 7_000)}\n\n` : ""}${evidence}

Сформируй итоговый ответ владельцу.
Строго отличай реальные результаты выполнения от предположений.
Не утверждай, что запускал что-либо кроме указанного VERIFIED VERCEL SANDBOX EXECUTION.
Если exitCode не 0 — честно объясни ошибку.
${sources.length ? "Используй только переданные реальные источники для веб-фактов." : ""}`,
    history: args.history.slice(-6),
    maxHistory: 6,
  });

  if (!final.response.ok || !final.data?.choices?.[0]?.message?.content) {
    return syntheticSandboxRun(mode, execution, sources);
  }

  return {
    response: final.response,
    data: final.data,
    provider: final.provider,
    providerDetail: final.providerDetail,
    model: final.model,
    mode,
    toolsUsed: [
      ...(sources.length ? ["direct_web_search:server"] : []),
      "code_interpreter:vercel_sandbox",
      `runtime:${execution.runtime}`,
    ],
    sources,
    webToolForced: sources.length > 0,
  };
}

async function runIndependentResearch(args: RunArgs): Promise<BrainRun | null> {
  try {
    const searched = await searchWebDirect(args.query, 6);
    const sources = directSources(searched.sources);
    const final = await textOnly(args, {
      systemContent: `${args.systemContent.slice(0, 8_000)}

VERIFIED SERVER WEB SEARCH RESULTS
${searched.context.slice(0, 8_000)}

Ответь на запрос владельца только по этим реальным результатам для актуальных веб-фактов.
Не утверждай, что посещал страницы, если у тебя есть только результаты поиска.
Перечисли источники.`,
      history: args.history.slice(-8),
    });

    if (!final.response.ok || !final.data?.choices?.[0]?.message?.content) {
      return null;
    }

    return {
      response: final.response,
      data: final.data,
      provider: final.provider,
      providerDetail: final.providerDetail,
      model: final.model,
      mode: "research",
      toolsUsed: ["direct_web_search:server"],
      sources,
      webToolForced: true,
    };
  } catch (error) {
    console.error("Khasroy independent research failed", error);
    return null;
  }
}

async function runIndependentSandbox(
  args: RunArgs,
): Promise<BrainRun | null> {
  try {
    const plan = await buildSandboxPlan(args);
    if (!plan) return null;
    const execution = await runCodeSandbox(plan);
    return await answerAfterExecution(args, "sandbox", plan, execution);
  } catch (error) {
    console.error("Khasroy Vercel Sandbox execution failed", error);
    return null;
  }
}

async function runIndependentAgentic(
  args: RunArgs,
): Promise<BrainRun | null> {
  try {
    const searched = await searchWebDirect(args.query, 6);
    const sources = directSources(searched.sources);
    const plan = await buildSandboxPlan(args, searched.context);
    if (!plan) return null;
    const execution = await runCodeSandbox(plan);
    return await answerAfterExecution(
      args,
      "agentic",
      plan,
      execution,
      searched.context,
      sources,
    );
  } catch (error) {
    console.error("Khasroy independent agentic pipeline failed", error);
    return null;
  }
}

export async function runBrain(args: RunArgs): Promise<BrainRun> {
  const mode = selectBrainMode(args.query, args.repositoryRead);

  if (mode === "research") {
    const independent = await runIndependentResearch(args);
    if (independent) return independent;
  }

  if (mode === "sandbox") {
    const independent = await runIndependentSandbox(args);
    if (independent) return independent;
  }

  if (mode === "agentic") {
    const independent = await runIndependentAgentic(args);
    if (independent) return independent;
  }

  return normalizeLegacy(await runLegacyBrain(args));
}

export function usedWebTool(run: BrainRun) {
  return (
    run.webToolForced ||
    run.sources.length > 0 ||
    run.toolsUsed.some((tool) => /search|visit|browser/iu.test(tool))
  );
}

export function usedCodeInterpreter(run: BrainRun) {
  return run.toolsUsed.some((tool) =>
    /python|code|interpreter|vercel_sandbox/iu.test(tool),
  );
}
