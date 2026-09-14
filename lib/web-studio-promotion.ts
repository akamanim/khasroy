import { randomBytes } from "node:crypto";
import { resolveSecret } from "@/lib/server-integrations";
import { upsertSkill } from "@/lib/server-memory";
import type { WebStudioSpec } from "@/lib/web-studio";
import type { WebProjectRecord } from "@/lib/web-studio-editor";

const STORE_ENDPOINT = process.env.KHASROY_WEB_STUDIO_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

type JsonRecord = Record<string, unknown>;

function asciiSlug(value: string) {
  const ascii = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-").slice(0, 58);
  return ascii || `khasroy-site-${Date.now().toString(36)}`;
}

function safeSpec(value: unknown): WebStudioSpec {
  if (!value || typeof value !== "object") throw new Error("web_project_spec_invalid");
  const row = value as JsonRecord;
  if (typeof row.slug !== "string" || typeof row.brandName !== "string" || !Array.isArray(row.services) || !Array.isArray(row.advantages)) {
    throw new Error("web_project_spec_invalid");
  }
  return value as WebStudioSpec;
}

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function renderProject(spec: WebStudioSpec) {
  const services = JSON.stringify(spec.services);
  const advantages = JSON.stringify(spec.advantages);
  const page = `const services=${services};\nconst advantages=${advantages};\nexport default function Home(){return <main><section className="hero"><nav><strong>${esc(spec.brandName)}</strong><a href="#contact">${esc(spec.primaryCta)}</a></nav><div className="heroGrid"><div><span className="eyebrow">${esc(spec.style.toUpperCase())}</span><h1>${esc(spec.tagline)}</h1><p>${esc(spec.description)}</p><div className="actions"><a className="primary" href="#contact">${esc(spec.primaryCta)}</a><a className="secondary" href="#services">${esc(spec.secondaryCta)}</a></div></div><aside><span>Для кого</span><h2>${esc(spec.audience)}</h2><p>Структура собрана вокруг понятного оффера, доверия и быстрого целевого действия.</p></aside></div></section><section id="services" className="section"><span className="eyebrow">УСЛУГИ</span><h2>Что предлагаем</h2><div className="cards">{services.map((item,index)=><article key={item}><small>0{index+1}</small><h3>{item}</h3><p>Понятное решение под задачу клиента без лишней сложности.</p></article>)}</div></section><section className="section split"><div><span className="eyebrow">ПОЧЕМУ МЫ</span><h2>Причины выбрать ${esc(spec.brandName)}</h2></div><div className="benefits">{advantages.map((item)=><div key={item}>✓ {item}</div>)}</div></section><section id="contact" className="section contact"><div><span className="eyebrow">СВЯЗАТЬСЯ</span><h2>${esc(spec.contactText)}</h2></div>${spec.leadForm ? `<form action="/api/lead" method="post"><input name="name" placeholder="Ваше имя" required/><input name="phone" placeholder="Телефон / WhatsApp" required/><textarea name="message" placeholder="Коротко о задаче"/><input className="trap" name="website" tabIndex={-1} autoComplete="off"/><button type="submit">${esc(spec.primaryCta)}</button></form>` : `<a className="primary" href="mailto:hello@example.com">${esc(spec.primaryCta)}</a>`}</section></main>}\n`;
  const css = `:root{--bg:${spec.palette.background};--surface:${spec.palette.surface};--text:${spec.palette.text};--muted:${spec.palette.muted};--accent:${spec.palette.accent}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.hero,.section{max-width:1180px;margin:auto;padding:32px 24px}.hero{min-height:82vh;display:flex;flex-direction:column;justify-content:space-between}nav{display:flex;justify-content:space-between;align-items:center;padding:8px 0 72px}nav a,.primary{background:var(--accent);color:#041014;text-decoration:none;padding:13px 18px;border-radius:999px;font-weight:800}.heroGrid{display:grid;grid-template-columns:1.5fr .8fr;gap:40px;align-items:end}h1{font-size:clamp(48px,8vw,102px);line-height:.92;letter-spacing:-.06em;margin:18px 0 24px;max-width:900px}h2{font-size:clamp(32px,5vw,58px);line-height:1;letter-spacing:-.04em;margin:14px 0 24px}p{color:var(--muted);font-size:18px;line-height:1.65;max-width:760px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.18em;font-weight:800}.actions{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap}.secondary{border:1px solid #ffffff30;color:var(--text);text-decoration:none;padding:13px 18px;border-radius:999px}aside,.cards article,.contact{background:linear-gradient(145deg,var(--surface),#ffffff08);border:1px solid #ffffff12;border-radius:28px}aside{padding:28px}.section{padding-top:110px;padding-bottom:80px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.cards article{padding:28px;min-height:220px}.cards small{color:var(--accent)}.split{display:grid;grid-template-columns:1fr 1fr;gap:50px}.benefits{display:grid;gap:12px}.benefits div{padding:18px 20px;border-bottom:1px solid #ffffff12;font-size:20px}.contact{margin-top:80px;margin-bottom:40px;padding:42px;display:grid;grid-template-columns:1fr 1fr;gap:34px}form{display:grid;gap:12px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:15px;border-radius:14px;border:1px solid #ffffff18;background:#00000022;color:var(--text)}textarea{min-height:110px;resize:vertical}button{border:0;padding:15px 18px;border-radius:14px;background:var(--accent);font-weight:800;cursor:pointer}.trap{position:absolute!important;left:-9999px!important;opacity:0!important;pointer-events:none!important}@media(max-width:760px){.heroGrid,.split,.contact{grid-template-columns:1fr}.cards{grid-template-columns:1fr}nav{padding-bottom:54px}.hero{min-height:auto;padding-bottom:70px}h1{font-size:52px}.section{padding-top:70px}.contact{margin:40px 16px 20px;padding:28px 22px}}`;
  const leadRoute = `import { NextResponse } from "next/server";\nexport async function POST(request:Request){const form=await request.formData();const endpoint=process.env.KHASROY_LEAD_ENDPOINT||"";const siteToken=process.env.KHASROY_SITE_TOKEN||"";const projectSlug=process.env.KHASROY_PROJECT_SLUG||"";if(!endpoint||!siteToken||!projectSlug)return NextResponse.redirect(new URL("/?lead=offline",request.url),{status:303});const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"submit_lead",projectSlug,siteToken,name:String(form.get("name")||"").slice(0,120),phone:String(form.get("phone")||"").slice(0,120),message:String(form.get("message")||"").slice(0,2000),website:String(form.get("website")||"").slice(0,240)}),cache:"no-store"}).catch(()=>null);return NextResponse.redirect(new URL(response?.ok?"/?lead=sent":"/?lead=error",request.url),{status:303})}\n`;
  return {
    "package.json": JSON.stringify({ scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "16.2.6", react: "19.1.0", "react-dom": "19.1.0" }, devDependencies: { "@types/node": "^22", "@types/react": "^19", typescript: "^5" } }, null, 2),
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "next.config.mjs": "const nextConfig={};\nexport default nextConfig;\n",
    "app/layout.tsx": `import type { ReactNode } from "react";\nimport "./globals.css";\nexport const metadata={title:${JSON.stringify(spec.brandName)},description:${JSON.stringify(spec.description)}};\nexport default function RootLayout({children}:{children:ReactNode}){return <html lang="ru"><body>{children}</body></html>}\n`,
    "app/page.tsx": page,
    "app/globals.css": css,
    "app/api/lead/route.ts": leadRoute,
    ".gitignore": ".next\nnode_modules\n.env*\n",
    "README.md": `# ${spec.brandName}\n\nPromoted from a verified Khasroy Web Studio draft.\n`,
  } as Record<string, string>;
}

async function store(ownerKey: string, payload: Record<string, unknown>) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: STORE_KEY },
    body: JSON.stringify({ ownerKey, ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`web_studio_store_${response.status}`);
  return data;
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as Record<string, any> | null;
  const message = typeof data?.message === "string" ? data.message : "request_failed";
  if (!response.ok) throw new Error(`github_${response.status}:${message}`);
  return data || {};
}

async function commitFiles(repoFullName: string, files: Record<string, string>, token: string, message: string) {
  const ref = await gh(`/repos/${repoFullName}/git/ref/heads/main`, token);
  const parent = String(ref.object?.sha || "");
  if (!parent) throw new Error("github_main_ref_missing");
  const commit = await gh(`/repos/${repoFullName}/git/commits/${parent}`, token);
  const baseTree = String(commit.tree?.sha || "");
  const blobs = await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = await gh(`/repos/${repoFullName}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) });
    return { path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await gh(`/repos/${repoFullName}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: blobs }) });
  const next = await gh(`/repos/${repoFullName}/git/commits`, token, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }) });
  await gh(`/repos/${repoFullName}/git/refs/heads/main`, token, { method: "PATCH", body: JSON.stringify({ sha: next.sha, force: false }) });
  return String(next.sha || "");
}

async function ensureRepository(spec: WebStudioSpec, files: Record<string, string>, token: string, existing?: string | null) {
  if (existing) {
    const sha = await commitFiles(existing, files, token, "feat: promote verified Khasroy draft");
    return { repoFullName: existing, repoUrl: `https://github.com/${existing}`, commitSha: sha };
  }
  const user = await gh("/user", token);
  const login = String(user.login || "");
  if (!login) throw new Error("github_user_missing");
  let repoName = asciiSlug(spec.slug || spec.projectName);
  let repo: Record<string, any>;
  try {
    repo = await gh("/user/repos", token, { method: "POST", body: JSON.stringify({ name: repoName, description: `${spec.brandName} — promoted by Khasroy Web Studio`, private: false, auto_init: true }) });
  } catch (error) {
    if (!/github_422/iu.test(String(error))) throw error;
    repoName = `${repoName}-${Date.now().toString(36).slice(-4)}`;
    repo = await gh("/user/repos", token, { method: "POST", body: JSON.stringify({ name: repoName, description: `${spec.brandName} — promoted by Khasroy Web Studio`, private: false, auto_init: true }) });
  }
  const fullName = String(repo.full_name || `${login}/${repoName}`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const commitSha = await commitFiles(fullName, files, token, "feat: promote verified Khasroy draft");
  return { repoFullName: fullName, repoUrl: String(repo.html_url || `https://github.com/${fullName}`), commitSha };
}

function vercelMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "failed";
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : "failed";
}

async function ensureVercelProject(token: string, desiredName: string, repoFullName: string, existing?: string | null) {
  const teamId = process.env.KHASROY_VERCEL_TEAM_ID?.trim();
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  if (existing) return { id: existing, query };
  const attempt = async (name: string) => {
    const response = await fetch(`https://api.vercel.com/v11/projects${query}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name, framework: "nextjs", gitRepository: { repo: repoFullName, type: "github" } }), signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { response, payload, name };
  };
  let created = await attempt(asciiSlug(desiredName));
  if (!created.response.ok && created.response.status === 409) created = await attempt(`${asciiSlug(desiredName).slice(0, 48)}-${Date.now().toString(36).slice(-5)}`);
  if (!created.response.ok) throw new Error(`vercel_project_${created.response.status}:${vercelMessage(created.payload)}`);
  return { id: String(created.payload?.id || created.payload?.name || created.name), query };
}

async function configureEnv(args: { token: string; projectId: string; query: string; projectSlug: string; siteToken: string }) {
  const response = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(args.projectId)}/env?upsert=true${args.query ? `&${args.query.slice(1)}` : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify([
      { key: "KHASROY_LEAD_ENDPOINT", value: STORE_ENDPOINT, type: "plain", target: ["production", "preview"] },
      { key: "KHASROY_PROJECT_SLUG", value: args.projectSlug, type: "plain", target: ["production", "preview"] },
      { key: "KHASROY_SITE_TOKEN", value: args.siteToken, type: "encrypted", target: ["production", "preview"] },
    ]),
    signal: AbortSignal.timeout(18_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`vercel_env_${response.status}:${vercelMessage(payload)}`);
}

async function waitForDeployment(token: string, deploymentId: string, query: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`vercel_status_${response.status}`);
    const state = String(data?.readyState || data?.status || "").toUpperCase();
    if (state === "READY") return true;
    if (["ERROR", "CANCELED", "CANCELLED"].includes(state)) throw new Error(`vercel_deployment_${state.toLowerCase()}`);
  }
  return false;
}

async function verifyHttp(url: string) {
  try {
    const response = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
}

async function deployProduction(args: { token: string; projectId: string; query: string; repoFullName: string }) {
  const [org, repo] = args.repoFullName.split("/");
  if (!org || !repo) throw new Error("github_repo_identity_invalid");
  const projectResponse = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(args.projectId)}${args.query}`, { headers: { Authorization: `Bearer ${args.token}` }, signal: AbortSignal.timeout(15_000) });
  const project = await projectResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!projectResponse.ok) throw new Error(`vercel_project_${projectResponse.status}:${vercelMessage(project)}`);
  const name = String(project?.name || "");
  if (!name) throw new Error("vercel_project_name_missing");
  const deploy = await fetch(`https://api.vercel.com/v13/deployments${args.query}`, { method: "POST", headers: { Authorization: `Bearer ${args.token}`, "content-type": "application/json" }, body: JSON.stringify({ name, target: "production", gitSource: { type: "github", repo, ref: "main", org } }), signal: AbortSignal.timeout(20_000) });
  const data = await deploy.json().catch(() => null) as Record<string, unknown> | null;
  if (!deploy.ok) throw new Error(`vercel_deploy_${deploy.status}:${vercelMessage(data)}`);
  const deploymentId = String(data?.id || "");
  const deployUrl = data?.url ? `https://${String(data.url)}` : "";
  const deploymentReady = deploymentId ? await waitForDeployment(args.token, deploymentId, args.query) : false;
  const httpVerified = Boolean(deployUrl && deploymentReady && await verifyHttp(deployUrl));
  if (!deploymentReady) throw new Error("vercel_deployment_not_ready_before_deadline");
  if (!httpVerified) throw new Error("vercel_deployment_http_verification_failed");
  return { deploymentId, deployUrl, deploymentReady, httpVerified };
}

export async function promoteStoredWebProject(args: { ownerKey: string; project: WebProjectRecord }) {
  const spec = safeSpec(args.project.spec);
  spec.slug = args.project.project_slug;
  const files = renderProject(spec);
  const [githubToken, vercelToken] = await Promise.all([
    resolveSecret(args.ownerKey, "github", [process.env.KHASROY_GITHUB_TOKEN, process.env.GITHUB_TOKEN]),
    resolveSecret(args.ownerKey, "vercel", [process.env.KHASROY_VERCEL_TOKEN, process.env.VERCEL_TOKEN]),
  ]);
  if (!githubToken || !vercelToken) throw new Error("web_studio_publish_credentials_missing");

  const siteToken = randomBytes(30).toString("base64url");
  await store(args.ownerKey, { action: "set_site_token", projectSlug: args.project.project_slug, siteToken });
  await store(args.ownerKey, { action: "upsert_project", projectSlug: args.project.project_slug, status: "promoting", brief: args.project.brief, spec, repoFullName: args.project.repo_full_name, repoUrl: args.project.repo_url, vercelProjectId: args.project.vercel_project_id, deployUrl: args.project.deploy_url });

  try {
    const repo = await ensureRepository(spec, files, githubToken, args.project.repo_full_name);
    const vercel = await ensureVercelProject(vercelToken, spec.slug, repo.repoFullName, args.project.vercel_project_id);
    await configureEnv({ token: vercelToken, projectId: vercel.id, query: vercel.query, projectSlug: args.project.project_slug, siteToken });
    const deployment = await deployProduction({ token: vercelToken, projectId: vercel.id, query: vercel.query, repoFullName: repo.repoFullName });
    await store(args.ownerKey, { action: "upsert_project", projectSlug: args.project.project_slug, status: "published", brief: args.project.brief, spec, repoFullName: repo.repoFullName, repoUrl: repo.repoUrl, vercelProjectId: vercel.id, deployUrl: deployment.deployUrl });
    await upsertSkill(args.ownerKey, { slug: "verified_draft_promotion", name: "Публикация проверенного черновика", description: "Хасрой публикует в production только сохранённый черновик, прошедший свежие HTTP и quality/mobile проверки, без повторной AI-регенерации.", status: "verified", level: 2, testsPassed: 1, metadata: { projectSlug: args.project.project_slug, repo: repo.repoFullName, commitSha: repo.commitSha, deployUrl: deployment.deployUrl, httpVerified: true, regenerated: false } }).catch(() => undefined);
    return { ok: true, mode: "verified_draft_promotion_v1", projectSlug: args.project.project_slug, spec, repoFullName: repo.repoFullName, repoUrl: repo.repoUrl, commitSha: repo.commitSha, vercelProjectId: vercel.id, ...deployment, regenerated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "promotion_failed");
    await store(args.ownerKey, { action: "upsert_project", projectSlug: args.project.project_slug, status: "promotion_failed", brief: args.project.brief, spec, repoFullName: args.project.repo_full_name, repoUrl: args.project.repo_url, vercelProjectId: args.project.vercel_project_id, deployUrl: args.project.deploy_url, lastError: message }).catch(() => undefined);
    throw error;
  }
}
