const SELF_REPOSITORY = "akamanim/khasroy";
const SELF_BRANCH = "main";

const CORE_PATHS = [
  "package.json",
  "app/api/chat/route.ts",
  "lib/server-memory.ts",
  "lib/server-github.ts",
  "components/khasroy/core.tsx",
  "app/page.tsx",
];

const EXTRA_PATHS = [
  "README.md",
  "app/api/auth/route.ts",
  "lib/chat.ts",
  "lib/server-auth.ts",
  "app/layout.tsx",
  "app/globals.css",
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
]);

type TreeEntry = {
  path?: string;
  type?: string;
  size?: number;
};

type TreeResponse = {
  sha?: string;
  tree?: TreeEntry[];
};

type CommitResponse = {
  sha?: string;
};

export type RepositoryContext = {
  repository: string;
  branch: string;
  commit: string;
  files: string[];
  context: string;
};

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "khasroy-ai",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = process.env.KHASROY_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function extension(path: string) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function isReadableSource(entry: TreeEntry): entry is TreeEntry & { path: string } {
  if (entry.type !== "blob" || typeof entry.path !== "string") return false;
  if (typeof entry.size === "number" && entry.size > 180_000) return false;
  if (entry.path.includes("node_modules/") || entry.path.includes(".next/")) return false;
  if (entry.path.endsWith("package-lock.json") || entry.path.endsWith("pnpm-lock.yaml")) return false;
  return TEXT_EXTENSIONS.has(extension(entry.path));
}

function queryTerms(query: string) {
  return query
    .toLowerCase()
    .replace(/[^a-zа-яё0-9_./-]+/giu, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3)
    .slice(0, 16);
}

function scorePath(path: string, terms: string[]) {
  const lower = path.toLowerCase();
  let score = CORE_PATHS.includes(path) ? 50 : EXTRA_PATHS.includes(path) ? 20 : 0;

  for (const term of terms) {
    if (lower.includes(term)) score += 8;
    const fileName = lower.split("/").pop() || "";
    if (fileName.includes(term)) score += 5;
  }

  if (lower.startsWith("app/api/")) score += 4;
  if (lower.startsWith("lib/")) score += 3;
  if (lower.startsWith("components/khasroy/")) score += 3;
  return score;
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return (await response.json()) as T;
}

function compactSource(source: string) {
  const normalized = source.trim();
  if (normalized.length <= 4_600) return normalized;

  const head = normalized.slice(0, 3_100);
  const tail = normalized.slice(-1_300);
  return `${head}\n\n/* ... middle omitted by Khasroy GitHub reader ... */\n\n${tail}`;
}

async function fetchFile(path: string) {
  const url = `https://raw.githubusercontent.com/${SELF_REPOSITORY}/${SELF_BRANCH}/${path}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "khasroy-ai" },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`GitHub raw ${response.status}: ${path}`);
  return compactSource(await response.text());
}

export function shouldReadSelfRepository(message: string) {
  const text = message.toLowerCase();
  const selfReference = /(хасро|твой код|свой код|собственн.*код|собственн.*репозитор|этот проект|khasroy)/iu.test(text);
  const repoIntent = /(github|гитхаб|репозитор|архитектур|исходн.*код|структур.*проект|файл|как ты устроен|как устроен|проанализируй.*код|изучи.*код|прочитай.*код)/iu.test(text);
  return selfReference && repoIntent;
}

export async function buildSelfRepositoryContext(query: string): Promise<RepositoryContext> {
  const [treeResult, commitResult] = await Promise.allSettled([
    githubJson<TreeResponse>(
      `https://api.github.com/repos/${SELF_REPOSITORY}/git/trees/${SELF_BRANCH}?recursive=1`,
    ),
    githubJson<CommitResponse>(
      `https://api.github.com/repos/${SELF_REPOSITORY}/commits/${SELF_BRANCH}`,
    ),
  ]);

  const tree = treeResult.status === "fulfilled" ? treeResult.value : null;
  const commit = commitResult.status === "fulfilled" ? commitResult.value : null;
  const entries = (tree?.tree || []).filter(isReadableSource);
  const terms = queryTerms(query);

  const selected = new Set<string>(CORE_PATHS);

  if (entries.length) {
    const ranked = entries
      .map((entry) => ({ path: entry.path, score: scorePath(entry.path, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    for (const item of ranked) {
      if (selected.size >= 7) break;
      selected.add(item.path);
    }
  } else {
    for (const path of EXTRA_PATHS) {
      if (selected.size >= 7) break;
      selected.add(path);
    }
  }

  const candidates = [...selected].slice(0, 7);
  const loaded = await Promise.allSettled(
    candidates.map(async (path) => ({ path, content: await fetchFile(path) })),
  );

  const sections: string[] = [];
  const loadedFiles: string[] = [];

  for (const result of loaded) {
    if (result.status !== "fulfilled") continue;
    loadedFiles.push(result.value.path);
    sections.push(`\n--- FILE: ${result.value.path} ---\n${result.value.content}`);
  }

  if (!loadedFiles.length) {
    throw new Error("GitHub self-reader could not load any repository files");
  }

  const treePreview = entries.length
    ? entries
        .map((entry) => entry.path)
        .filter((path) => CORE_PATHS.includes(path) || EXTRA_PATHS.includes(path) || path.startsWith("app/api/") || path.startsWith("lib/") || path.startsWith("components/khasroy/"))
        .slice(0, 60)
        .join("\n")
    : loadedFiles.join("\n");

  const context = `\n\nGITHUB SELF-REPOSITORY CONTEXT\nИсточник: реальные файлы публичного репозитория ${SELF_REPOSITORY}, ветка ${SELF_BRANCH}.\nCommit: ${commit?.sha || "metadata-unavailable"}. Tree SHA: ${tree?.sha || "metadata-unavailable"}.\nФайлы ниже были фактически загружены серверным GitHub-модулем. Часть длинных файлов намеренно сокращена, чтобы не переполнять контекст AI. Не придумывай невидимые части кода.\n\nФАКТИЧЕСКИ ПРОЧИТАННЫЕ ФАЙЛЫ:\n${loadedFiles.map((path) => `- ${path}`).join("\n")}\n\nРелевантное дерево проекта:\n${treePreview}\n${sections.join("\n")}`;

  return {
    repository: SELF_REPOSITORY,
    branch: SELF_BRANCH,
    commit: commit?.sha || "metadata-unavailable",
    files: loadedFiles,
    context: context.slice(0, 30_000),
  };
}
