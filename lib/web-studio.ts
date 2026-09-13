import { createHash } from "node:crypto";
import { runBrain } from "@/lib/brain/router";
import { upsertSkill } from "@/lib/server-memory";

const STORE_ENDPOINT =
  process.env.KHASROY_WEB_STUDIO_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY =
  process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

export type WebStudioSpec = {
  projectName: string;
  slug: string;
  brandName: string;
  tagline: string;
  description: string;
  audience: string;
  primaryCta: string;
  secondaryCta: string;
  contactText: string;
  services: string[];
  advantages: string[];
  palette: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
  };
  style: string;
  leadForm: boolean;
};

type PublishResult = {
  repoFullName: string;
  repoUrl: string;
  vercelProjectId?: string;
  deployUrl?: string;
  deploymentId?: string;
};

function asciiSlug(value: string) {
  const ascii = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 58);
  return ascii || `khasroy-site-${Date.now().toString(36)}`;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1] || text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function strings(value: unknown, fallback: string[], max = 6) {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
  return result.length ? result : fallback;
}

function text(value: unknown, fallback: string, limit = 300) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : fallback;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value.trim())
    ? value.trim()
    : fallback;
}

function fallbackSpec(brief: string): WebStudioSpec {
  const compact = brief.replace(/\s+/gu, " ").trim();
  const guessedName = compact.match(/(?:для|компани[ия]|бренд[а]?|магазин[а]?)\s+[«\"]?([\p{L}0-9 ._-]{2,40})/iu)?.[1]?.trim();
  const brandName = guessedName || "Новый проект";
  return {
    projectName: brandName,
    slug: asciiSlug(brandName),
    brandName,
    tagline: "Современный сайт, который помогает продавать",
    description: compact.slice(0, 360) || "Современный сайт для бизнеса.",
    audience: "Клиенты бизнеса",
    primaryCta: "Получить консультацию",
    secondaryCta: "Посмотреть услуги",
    contactText: "Оставьте заявку — мы свяжемся с вами.",
    services: ["Основная услуга", "Консультация", "Индивидуальное решение"],
    advantages: ["Быстрый ответ", "Прозрачные условия", "Современный подход"],
    palette: {
      background: "#071019",
      surface: "#101c27",
      text: "#f7fbff",
      muted: "#9fb1bf",
      accent: "#6ee7d8",
    },
    style: "premium modern",
    leadForm: true,
  };
}

export function looksLikeWebsiteBuildRequest(value: string) {
  return /(создай|сделай|собери|разработай|нужен|хочу).{0,50}(сайт|лендинг|landing|website|web[- ]?site)|(?:сайт|лендинг).{0,40}(для|под ключ|с нуля)/iu.test(value);
}

export async function planWebsite(args: { apiKey: string; brief: string }) {
  const fallback = fallbackSpec(args.brief);
  const query = `Составь спецификацию продающего сайта по брифу владельца:\n${args.brief.slice(0, 6000)}`;
  try {
    const brain = await runBrain({
      apiKey: args.apiKey,
      defaultModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      systemContent: `Ты Lead Web Designer + Product Strategist системы Khasroy Web Studio. Верни ТОЛЬКО JSON без Markdown. Нельзя обещать то, чего нет в брифе. Сделай реалистичный, коммерческий, mobile-first сайт. Схема JSON: {"projectName":"","slug":"ascii-kebab","brandName":"","tagline":"","description":"","audience":"","primaryCta":"","secondaryCta":"","contactText":"","services":[""],"advantages":[""],"palette":{"background":"#RRGGBB","surface":"#RRGGBB","text":"#RRGGBB","muted":"#RRGGBB","accent":"#RRGGBB"},"style":"","leadForm":true}.`,
      history: [{ role: "user", content: query }],
      query,
      repositoryRead: false,
    });
    const raw = brain.data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = extractJson(raw);
    if (!brain.response.ok || !parsed) return fallback;
    const palette = parsed.palette && typeof parsed.palette === "object"
      ? parsed.palette as Record<string, unknown>
      : {};
    const brandName = text(parsed.brandName, fallback.brandName, 80);
    return {
      projectName: text(parsed.projectName, brandName, 80),
      slug: asciiSlug(text(parsed.slug, brandName, 80)),
      brandName,
      tagline: text(parsed.tagline, fallback.tagline, 180),
      description: text(parsed.description, fallback.description, 600),
      audience: text(parsed.audience, fallback.audience, 220),
      primaryCta: text(parsed.primaryCta, fallback.primaryCta, 80),
      secondaryCta: text(parsed.secondaryCta, fallback.secondaryCta, 80),
      contactText: text(parsed.contactText, fallback.contactText, 220),
      services: strings(parsed.services, fallback.services, 6),
      advantages: strings(parsed.advantages, fallback.advantages, 6),
      palette: {
        background: color(palette.background, fallback.palette.background),
        surface: color(palette.surface, fallback.palette.surface),
        text: color(palette.text, fallback.palette.text),
        muted: color(palette.muted, fallback.palette.muted),
        accent: color(palette.accent, fallback.palette.accent),
      },
      style: text(parsed.style, fallback.style, 120),
      leadForm: parsed.leadForm !== false,
    } satisfies WebStudioSpec;
  } catch (error) {
    console.error("Khasroy Web Studio planning failed", error);
    return fallback;
  }
}

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function renderProject(spec: WebStudioSpec) {
  const services = JSON.stringify(spec.services);
  const advantages = JSON.stringify(spec.advantages);
  const page = `const services = ${services};\nconst advantages = ${advantages};\n\nexport default function Home() {\n  return (\n    <main>\n      <section className=\"hero\">\n        <nav><strong>${esc(spec.brandName)}</strong><a href=\"#contact\">${esc(spec.primaryCta)}</a></nav>\n        <div className=\"hero-grid\">\n          <div>\n            <span className=\"eyebrow\">${esc(spec.style.toUpperCase())}</span>\n            <h1>${esc(spec.tagline)}</h1>\n            <p>${esc(spec.description)}</p>\n            <div className=\"actions\"><a className=\"primary\" href=\"#contact\">${esc(spec.primaryCta)}</a><a className=\"secondary\" href=\"#services\">${esc(spec.secondaryCta)}</a></div>\n          </div>\n          <aside><span>Для кого</span><h2>${esc(spec.audience)}</h2><p>Структура сайта собрана вокруг понятного оффера, доверия и быстрого целевого действия.</p></aside>\n        </div>\n      </section>\n\n      <section id=\"services\" className=\"section\"><span className=\"eyebrow\">УСЛУГИ</span><h2>Что предлагаем</h2><div className=\"cards\">{services.map((item, index) => <article key={item}><small>0{index + 1}</small><h3>{item}</h3><p>Понятное решение под задачу клиента без лишней сложности.</p></article>)}</div></section>\n\n      <section className=\"section split\"><div><span className=\"eyebrow\">ПОЧЕМУ МЫ</span><h2>Причины выбрать ${esc(spec.brandName)}</h2></div><div className=\"benefits\">{advantages.map((item) => <div key={item}>✓ {item}</div>)}</div></section>\n\n      <section id=\"contact\" className=\"section contact\"><div><span className=\"eyebrow\">СВЯЗАТЬСЯ</span><h2>${esc(spec.contactText)}</h2></div>${spec.leadForm ? `<form action=\"/api/lead\" method=\"post\"><input name=\"name\" placeholder=\"Ваше имя\" required/><input name=\"phone\" placeholder=\"Телефон / WhatsApp\" required/><textarea name=\"message\" placeholder=\"Коротко о задаче\"/><button type=\"submit\">${esc(spec.primaryCta)}</button></form>` : `<a className=\"primary\" href=\"mailto:hello@example.com\">${esc(spec.primaryCta)}</a>`}</section>\n    </main>\n  );\n}\n`;

  const css = `:root{--bg:${spec.palette.background};--surface:${spec.palette.surface};--text:${spec.palette.text};--muted:${spec.palette.muted};--accent:${spec.palette.accent}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.hero,.section{max-width:1180px;margin:auto;padding:32px 24px}.hero{min-height:82vh;display:flex;flex-direction:column;justify-content:space-between}nav{display:flex;justify-content:space-between;align-items:center;padding:8px 0 72px}nav a,.primary{background:var(--accent);color:#041014;text-decoration:none;padding:13px 18px;border-radius:999px;font-weight:800}.hero-grid{display:grid;grid-template-columns:1.5fr .8fr;gap:40px;align-items:end}h1{font-size:clamp(48px,8vw,102px);line-height:.92;letter-spacing:-.06em;margin:18px 0 24px;max-width:900px}h2{font-size:clamp(32px,5vw,58px);line-height:1;letter-spacing:-.04em;margin:14px 0 24px}p{color:var(--muted);font-size:18px;line-height:1.65;max-width:760px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.18em;font-weight:800}.actions{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}.secondary{border:1px solid #ffffff30;color:var(--text);text-decoration:none;padding:13px 18px;border-radius:999px}aside,.cards article,.contact{background:linear-gradient(145deg,var(--surface),#ffffff08);border:1px solid #ffffff12;border-radius:28px}aside{padding:28px}.section{padding-top:110px;padding-bottom:80px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.cards article{padding:28px;min-height:220px}.cards small{color:var(--accent)}.split{display:grid;grid-template-columns:1fr 1fr;gap:50px}.benefits{display:grid;gap:12px}.benefits div{padding:18px 20px;border-bottom:1px solid #ffffff12;font-size:20px}.contact{margin-top:80px;margin-bottom:40px;padding:42px;display:grid;grid-template-columns:1fr 1fr;gap:34px}form{display:grid;gap:12px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:15px;border-radius:14px;border:1px solid #ffffff18;background:#00000022;color:var(--text)}textarea{min-height:110px;resize:vertical}button{border:0;padding:15px 18px;border-radius:14px;background:var(--accent);font-weight:800;cursor:pointer}@media(max-width:760px){.hero-grid,.split,.contact{grid-template-columns:1fr}.cards{grid-template-columns:1fr}nav{padding-bottom:54px}.hero{min-height:auto;padding-bottom:70px}h1{font-size:52px}.section{padding-top:70px}.contact{margin:40px 16px 20px;padding:28px 22px}}`;

  const leadRoute = `import { NextResponse } from \"next/server\";\nexport async function POST(request: Request) {\n  const form = await request.formData();\n  const lead = { name: String(form.get(\"name\") || \"\").slice(0,120), phone: String(form.get(\"phone\") || \"\").slice(0,120), message: String(form.get(\"message\") || \"\").slice(0,1500), createdAt: new Date().toISOString() };\n  console.log(\"NEW_LEAD\", lead);\n  return NextResponse.redirect(new URL(\"/?sent=1\", request.url), { status: 303 });\n}\n`;

  return {
    "package.json": JSON.stringify({ scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "15.5.7", react: "19.1.0", "react-dom": "19.1.0" }, devDependencies: { "@types/node": "^22", "@types/react": "^19", typescript: "^5" } }, null, 2),
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "next.config.mjs": "const nextConfig = {};\nexport default nextConfig;\n",
    "app/layout.tsx": `import type { ReactNode } from \"react\";\nimport \"./globals.css\";\nexport const metadata = { title: ${JSON.stringify(spec.brandName)}, description: ${JSON.stringify(spec.description)} };\nexport default function RootLayout({children}:{children:ReactNode}){return <html lang=\"ru\"><body>{children}</body></html>}\n`,
    "app/page.tsx": page,
    "app/globals.css": css,
    "app/api/lead/route.ts": leadRoute,
    ".gitignore": ".next\nnode_modules\n.env*\n",
    "README.md": `# ${spec.brandName}\n\nGenerated by Khasroy Web Studio.\n\n## Run\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
  } as Record<string, string>;
}

async function store(ownerKey: string, payload: Record<string, unknown>) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: STORE_KEY },
    body: JSON.stringify({ ownerKey, ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`web_studio_store_${response.status}`);
  return response.json();
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(18_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof data?.message === "string" ? data.message : "request_failed";
  if (!response.ok) throw new Error(`github_${response.status}:${message}`);
  return (data || {}) as Record<string, any>;
}

async function publishGithub(spec: WebStudioSpec, files: Record<string, string>, token: string) {
  const user = await gh("/user", token);
  const login = String(user.login || "");
  if (!login) throw new Error("github_user_missing");
  let repoName = asciiSlug(spec.slug || spec.projectName);
  let repo: Record<string, any>;
  try {
    repo = await gh("/user/repos", token, {
      method: "POST",
      body: JSON.stringify({ name: repoName, description: `${spec.brandName} — generated by Khasroy Web Studio`, private: false, auto_init: true }),
    });
  } catch (error) {
    if (!/github_422/iu.test(String(error))) throw error;
    repoName = `${repoName}-${Date.now().toString(36).slice(-4)}`;
    repo = await gh("/user/repos", token, {
      method: "POST",
      body: JSON.stringify({ name: repoName, description: `${spec.brandName} — generated by Khasroy Web Studio`, private: false, auto_init: true }),
    });
  }
  const fullName = String(repo.full_name || `${login}/${repoName}`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const ref = await gh(`/repos/${fullName}/git/ref/heads/main`, token);
  const commitSha = String(ref.object?.sha || "");
  const commit = await gh(`/repos/${fullName}/git/commits/${commitSha}`, token);
  const baseTree = String(commit.tree?.sha || "");
  const blobs = await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = await gh(`/repos/${fullName}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) });
    return { path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await gh(`/repos/${fullName}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: blobs }) });
  const nextCommit = await gh(`/repos/${fullName}/git/commits`, token, { method: "POST", body: JSON.stringify({ message: "feat: initial site generated by Khasroy Web Studio", tree: tree.sha, parents: [commitSha] }) });
  await gh(`/repos/${fullName}/git/refs/heads/main`, token, { method: "PATCH", body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  return { login, repoName, repoFullName: fullName, repoUrl: String(repo.html_url || `https://github.com/${fullName}`) };
}

async function publishVercel(args: { token: string; repoFullName: string; repoName: string; login: string; projectName: string }) {
  const teamId = process.env.KHASROY_VERCEL_TEAM_ID?.trim();
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const create = await fetch(`https://api.vercel.com/v11/projects${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: asciiSlug(args.projectName), framework: "nextjs", gitRepository: { repo: args.repoFullName, type: "github" } }),
    signal: AbortSignal.timeout(20_000),
  });
  const project = await create.json().catch(() => null) as Record<string, any> | null;
  if (!create.ok && create.status !== 409) throw new Error(`vercel_project_${create.status}:${project?.error?.message || "failed"}`);
  const projectName = String(project?.name || asciiSlug(args.projectName));
  const projectId = String(project?.id || "");
  const deploy = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: projectName, target: "production", gitSource: { type: "github", repo: args.repoName, ref: "main", org: args.login } }),
    signal: AbortSignal.timeout(20_000),
  });
  const deployment = await deploy.json().catch(() => null) as Record<string, any> | null;
  if (!deploy.ok) throw new Error(`vercel_deploy_${deploy.status}:${deployment?.error?.message || "failed"}`);
  const url = deployment?.url ? `https://${deployment.url}` : undefined;
  return { vercelProjectId: projectId || undefined, deployUrl: url, deploymentId: String(deployment?.id || "") || undefined };
}

export async function buildWebsite(args: { ownerKey: string; apiKey: string; brief: string; publish?: boolean }) {
  const spec = await planWebsite({ apiKey: args.apiKey, brief: args.brief });
  const files = renderProject(spec);
  await store(args.ownerKey, { action: "upsert_project", projectSlug: spec.slug, status: "building", brief: args.brief, spec }).catch(() => undefined);

  const githubToken = process.env.KHASROY_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const vercelToken = process.env.KHASROY_VERCEL_TOKEN?.trim() || process.env.VERCEL_TOKEN?.trim() || "";
  const shouldPublish = args.publish !== false && Boolean(githubToken && vercelToken);
  let published: PublishResult | null = null;

  if (shouldPublish) {
    try {
      const repo = await publishGithub(spec, files, githubToken);
      const deployment = await publishVercel({ token: vercelToken, repoFullName: repo.repoFullName, repoName: repo.repoName, login: repo.login, projectName: spec.slug });
      published = { repoFullName: repo.repoFullName, repoUrl: repo.repoUrl, ...deployment };
      await store(args.ownerKey, { action: "upsert_project", projectSlug: spec.slug, status: "published", brief: args.brief, spec, repoFullName: published.repoFullName, repoUrl: published.repoUrl, vercelProjectId: published.vercelProjectId, deployUrl: published.deployUrl });
      await upsertSkill(args.ownerKey, { slug: "turnkey_website_delivery", name: "Сайты под ключ", description: "Хасрой превращает бриф в готовый Next.js-проект, создаёт GitHub-репозиторий и запускает production deployment в Vercel.", status: "verified", level: 1, testsPassed: 1, metadata: { engine: "web_studio_v1", lastRepo: published.repoFullName, lastDeployUrl: published.deployUrl || null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "publish_failed");
      await store(args.ownerKey, { action: "upsert_project", projectSlug: spec.slug, status: "failed", brief: args.brief, spec, lastError: message }).catch(() => undefined);
      throw error;
    }
  } else {
    await upsertSkill(args.ownerKey, { slug: "website_project_compiler", name: "Компилятор сайтов", description: "Хасрой превращает короткий бизнес-бриф в production-ready структуру и исходники Next.js сайта.", status: "verified", level: 1, testsPassed: 1, metadata: { engine: "web_studio_v1", publishReady: Boolean(githubToken && vercelToken) } }).catch(() => undefined);
  }

  return {
    ok: true,
    mode: "web_studio_v1",
    spec,
    files: Object.keys(files),
    published,
    publishingConfigured: Boolean(githubToken && vercelToken),
  };
}

export function webStudioRuntimeStatus() {
  return {
    githubConfigured: Boolean(process.env.KHASROY_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()),
    vercelConfigured: Boolean(process.env.KHASROY_VERCEL_TOKEN?.trim() || process.env.VERCEL_TOKEN?.trim()),
    instagramConfigured: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN?.trim() && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim()),
    fingerprint: createHash("sha256").update("khasroy-web-studio-v1").digest("hex").slice(0, 12),
  };
}
