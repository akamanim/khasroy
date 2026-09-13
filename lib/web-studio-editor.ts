import { planWebsite, type WebStudioSpec } from "@/lib/web-studio";
import { upsertSkill } from "@/lib/server-memory";
import { resolveSecret } from "@/lib/server-integrations";

const STORE_ENDPOINT = process.env.KHASROY_WEB_STUDIO_ENDPOINT || "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

type JsonRecord = Record<string, unknown>;

export type WebProjectRecord = {
  id: string;
  project_slug: string;
  status: string;
  brief: string;
  spec: WebStudioSpec | JsonRecord;
  repo_full_name: string | null;
  repo_url: string | null;
  vercel_project_id: string | null;
  deploy_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SiteLead = {
  id: string;
  project_slug: string;
  name: string;
  phone: string;
  message: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function safeSpec(value: unknown): WebStudioSpec | null {
  if (!value || typeof value !== "object") return null;
  const row = value as JsonRecord;
  if (typeof row.brandName !== "string" || typeof row.slug !== "string") return null;
  return row as unknown as WebStudioSpec;
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
  if (!response.ok) {
    const code = data && typeof data === "object" && "error" in data ? String((data as JsonRecord).error || "") : "";
    throw new Error(`web_studio_store_${response.status}${code ? `:${code}` : ""}`);
  }
  return data;
}

export async function listWebProjects(ownerKey: string, limit = 50): Promise<WebProjectRecord[]> {
  const data = await store(ownerKey, { action: "list_projects", limit });
  return Array.isArray(data) ? data as WebProjectRecord[] : [];
}

export async function getWebProject(ownerKey: string, projectSlug: string): Promise<WebProjectRecord | null> {
  try {
    const data = await store(ownerKey, { action: "get_project", projectSlug }) as { project?: WebProjectRecord } | null;
    return data?.project || null;
  } catch (error) {
    if (/404|project_not_found/iu.test(String(error))) return null;
    throw error;
  }
}

export async function listSiteLeads(ownerKey: string, projectSlug?: string, limit = 50): Promise<SiteLead[]> {
  const data = await store(ownerKey, { action: "list_leads", projectSlug: projectSlug || undefined, limit });
  return Array.isArray(data) ? data as SiteLead[] : [];
}

export async function updateSiteLeadStatus(ownerKey: string, id: string, status: "new" | "contacted" | "qualified" | "won" | "lost" | "spam") {
  await store(ownerKey, { action: "update_lead_status", id, status });
  return { ok: true };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9а-яё]+/giu, " ").trim();
}

export async function resolveWebProject(ownerKey: string, query: string) {
  const projects = await listWebProjects(ownerKey, 50);
  if (!projects.length) return null;
  const q = normalize(query);
  const exact = projects.find((project) => q.includes(normalize(project.project_slug)));
  if (exact) return exact;
  const byBrand = projects.find((project) => {
    const spec = safeSpec(project.spec);
    return spec?.brandName ? q.includes(normalize(spec.brandName)) : false;
  });
  if (byBrand) return byBrand;
  const active = projects.filter((project) => project.status !== "archived");
  return active.length === 1 ? active[0] : null;
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
    "README.md": `# ${spec.brandName}\n\nGenerated and maintained by Khasroy Web Studio.\n`,
  } as Record<string, string>;
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  const message = typeof data?.message === "string" ? data.message : "request_failed";
  if (!response.ok) throw new Error(`github_${response.status}:${message}`);
  return (data || {}) as Record<string, any>;
}

async function commitProjectFiles(repoFullName: string, files: Record<string, string>, token: string, message: string) {
  const ref = await gh(`/repos/${repoFullName}/git/ref/heads/main`, token);
  const commitSha = String(ref.object?.sha || "");
  if (!commitSha) throw new Error("github_main_ref_missing");
  const commit = await gh(`/repos/${repoFullName}/git/commits/${commitSha}`, token);
  const baseTree = String(commit.tree?.sha || "");
  const blobs = await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = await gh(`/repos/${repoFullName}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) });
    return { path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await gh(`/repos/${repoFullName}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: blobs }) });
  const nextCommit = await gh(`/repos/${repoFullName}/git/commits`, token, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [commitSha] }) });
  await gh(`/repos/${repoFullName}/git/refs/heads/main`, token, { method: "PATCH", body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  return String(nextCommit.sha || "");
}

function vercelError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "failed";
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : "failed";
}

async function waitForDeployment(token: string, deploymentId: string, teamId?: string) {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
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

async function deployExistingProject(args: { token: string; projectId: string; repoFullName: string }) {
  const teamId = process.env.KHASROY_VERCEL_TEAM_ID?.trim();
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const projectResponse = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(args.projectId)}${query}`, { headers: { Authorization: `Bearer ${args.token}` }, signal: AbortSignal.timeout(15_000) });
  const project = await projectResponse.json().catch(() => null) as Record<string, unknown> | null;
  if (!projectResponse.ok) throw new Error(`vercel_project_${projectResponse.status}:${vercelError(project)}`);
  const name = String(project?.name || "");
  if (!name) throw new Error("vercel_project_name_missing");
  const [org, repo] = args.repoFullName.split("/");
  if (!org || !repo) throw new Error("github_repo_identity_invalid");
  const deploy = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, target: "production", gitSource: { type: "github", repo, ref: "main", org } }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await deploy.json().catch(() => null) as Record<string, unknown> | null;
  if (!deploy.ok) throw new Error(`vercel_deploy_${deploy.status}:${vercelError(data)}`);
  const deploymentId = String(data?.id || "");
  const deployUrl = data?.url ? `https://${String(data.url)}` : undefined;
  const ready = deploymentId ? await waitForDeployment(args.token, deploymentId, teamId) : false;
  const verified = deployUrl && ready ? await verifyHttp(deployUrl) : false;
  if (!ready) throw new Error("vercel_deployment_not_ready_before_deadline");
  if (deployUrl && !verified) throw new Error("vercel_deployment_http_verification_failed");
  return { deploymentId, deployUrl, deploymentReady: ready, httpVerified: Boolean(verified) };
}

export async function editWebsite(args: { ownerKey: string; apiKey: string; projectSlug: string; instruction: string }) {
  const project = await getWebProject(args.ownerKey, args.projectSlug);
  if (!project) throw new Error("web_project_not_found");
  const currentSpec = safeSpec(project.spec);
  if (!currentSpec) throw new Error("web_project_spec_invalid");
  if (!project.repo_full_name || !project.vercel_project_id) throw new Error("web_project_not_published");

  const revisionBrief = `Это ДОРАБОТКА существующего сайта. Сохрани бренд и факты, если владелец явно не просит их поменять.\nТекущая спецификация: ${JSON.stringify(currentSpec).slice(0, 7000)}\nТекущий исходный бриф: ${project.brief.slice(0, 5000)}\nИзменение владельца: ${args.instruction.slice(0, 5000)}`;
  const revised = await planWebsite({ apiKey: args.apiKey, brief: revisionBrief });
  revised.slug = project.project_slug;
  const files = renderProject(revised);
  const [githubToken, vercelToken] = await Promise.all([
    resolveSecret(args.ownerKey, "github", [process.env.KHASROY_GITHUB_TOKEN, process.env.GITHUB_TOKEN]),
    resolveSecret(args.ownerKey, "vercel", [process.env.KHASROY_VERCEL_TOKEN, process.env.VERCEL_TOKEN]),
  ]);
  if (!githubToken || !vercelToken) throw new Error("web_studio_publish_credentials_missing");

  await store(args.ownerKey, { action: "upsert_project", projectSlug: project.project_slug, status: "building", brief: project.brief, spec: revised, repoFullName: project.repo_full_name, repoUrl: project.repo_url, vercelProjectId: project.vercel_project_id, deployUrl: project.deploy_url });
  try {
    const commitSha = await commitProjectFiles(project.repo_full_name, files, githubToken, `feat: update site via Khasroy Web Studio — ${args.instruction.slice(0, 90)}`);
    const deployment = await deployExistingProject({ token: vercelToken, projectId: project.vercel_project_id, repoFullName: project.repo_full_name });
    const deployUrl = deployment.deployUrl || project.deploy_url || undefined;
    await store(args.ownerKey, { action: "upsert_project", projectSlug: project.project_slug, status: "published", brief: project.brief, spec: revised, repoFullName: project.repo_full_name, repoUrl: project.repo_url, vercelProjectId: project.vercel_project_id, deployUrl });
    await upsertSkill(args.ownerKey, {
      slug: "iterative_website_delivery",
      name: "Доработка сайтов в production",
      description: "Хасрой сохраняет проект, обновляет существующий GitHub-репозиторий, повторно деплоит Vercel и проверяет production URL после правок.",
      status: "verified",
      level: 2,
      testsPassed: 1,
      metadata: { projectSlug: project.project_slug, repo: project.repo_full_name, commitSha, deployUrl: deployUrl || null, httpVerified: deployment.httpVerified, credentialSource: "env_or_encrypted_vault" },
    }).catch(() => undefined);
    return { ok: true, mode: "web_studio_edit_v2", projectSlug: project.project_slug, spec: revised, repoFullName: project.repo_full_name, repoUrl: project.repo_url, commitSha, ...deployment, deployUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "edit_failed");
    await store(args.ownerKey, { action: "upsert_project", projectSlug: project.project_slug, status: "failed", brief: project.brief, spec: revised, repoFullName: project.repo_full_name, repoUrl: project.repo_url, vercelProjectId: project.vercel_project_id, deployUrl: project.deploy_url, lastError: message }).catch(() => undefined);
    throw error;
  }
}

export function looksLikeWebsiteRevisionRequest(value: string) {
  return /(доработ|измени|изменить|исправ|передел|обнови|обновить|добавь|убери|замени).{0,80}(сайт|лендинг|website)|(?:сайт|лендинг).{0,80}(доработ|измени|исправ|передел|обнов|добав|убери|замени)/iu.test(value);
}

export function looksLikeLeadRequest(value: string) {
  return /(покажи|какие|есть|новые|посмотри|выведи).{0,60}(заявк|лид|клиент).{0,40}(сайт|лендинг|web)?|(?:заявк|лид).{0,60}(сайт|лендинг|web)/iu.test(value);
}
