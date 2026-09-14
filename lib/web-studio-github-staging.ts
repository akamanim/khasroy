import { createHash } from "node:crypto";
import type { WebStudioSpec } from "@/lib/web-studio";

const GITHUB_API = "https://api.github.com";

type JsonRecord = Record<string, unknown>;

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function normalizeGitHubRepoName(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return normalized || `khasroy-site-${Date.now().toString(36)}`;
}

export function renderGitHubStagingProject(spec: WebStudioSpec, projectSlug: string) {
  const services = JSON.stringify(spec.services);
  const advantages = JSON.stringify(spec.advantages);
  const page = `const services=${services};\nconst advantages=${advantages};\nexport default function Home(){return <main><section><nav><strong>${esc(spec.brandName)}</strong><a href="#contact">${esc(spec.primaryCta)}</a></nav><p>${esc(spec.style.toUpperCase())}</p><h1>${esc(spec.tagline)}</h1><p>${esc(spec.description)}</p><p>Для кого: ${esc(spec.audience)}</p></section><section id="services"><h2>Услуги</h2>{services.map((item)=><article key={item}><h3>{item}</h3></article>)}</section><section><h2>Почему мы</h2>{advantages.map((item)=><p key={item}>✓ {item}</p>)}</section><section id="contact"><h2>${esc(spec.contactText)}</h2>${spec.leadForm ? `<form action="/api/lead" method="post"><input name="name" placeholder="Ваше имя" required/><input name="phone" placeholder="Телефон / WhatsApp" required/><textarea name="message" placeholder="Коротко о задаче"/><input className="trap" name="website" tabIndex={-1} autoComplete="off"/><button type="submit">${esc(spec.primaryCta)}</button></form>` : ""}</section></main>}\n`;
  const css = `:root{--bg:${spec.palette.background};--surface:${spec.palette.surface};--text:${spec.palette.text};--muted:${spec.palette.muted};--accent:${spec.palette.accent}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:28px}section{padding:54px 0}nav{display:flex;justify-content:space-between;gap:20px;align-items:center}a,button{background:var(--accent);color:#071014;border:0;border-radius:999px;padding:12px 18px;font-weight:800;text-decoration:none}h1{font-size:clamp(44px,8vw,92px);line-height:.95;letter-spacing:-.05em}h2{font-size:clamp(30px,5vw,52px)}p{color:var(--muted);font-size:18px;line-height:1.6}article{padding:22px;border:1px solid #ffffff1f;background:var(--surface);border-radius:20px;margin:12px 0}form{display:grid;gap:12px;max-width:620px}input,textarea{padding:14px;border-radius:12px;border:1px solid #ffffff22;background:var(--surface);color:var(--text)}textarea{min-height:120px}.trap{position:absolute!important;left:-9999px!important;opacity:0!important}@media(max-width:720px){main{padding:20px}section{padding:38px 0}h1{font-size:48px}}`;
  const leadRoute = `import { NextResponse } from "next/server";\nexport async function POST(request:Request){const form=await request.formData();const endpoint=process.env.KHASROY_LEAD_ENDPOINT||"";const siteToken=process.env.KHASROY_SITE_TOKEN||"";const projectSlug=process.env.KHASROY_PROJECT_SLUG||${JSON.stringify(projectSlug)};if(!endpoint||!siteToken)return NextResponse.redirect(new URL("/?lead=offline",request.url),{status:303});const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"submit_lead",projectSlug,siteToken,name:String(form.get("name")||"").slice(0,120),phone:String(form.get("phone")||"").slice(0,120),message:String(form.get("message")||"").slice(0,2000),website:String(form.get("website")||"").slice(0,240)}),cache:"no-store"}).catch(()=>null);return NextResponse.redirect(new URL(response?.ok?"/?lead=sent":"/?lead=error",request.url),{status:303})}\n`;
  const provenance = {
    generatedBy: "khasroy-web-studio",
    target: "github-staging",
    projectSlug,
    productionUntouched: true,
    generatedAt: new Date().toISOString(),
  };
  return {
    "package.json": JSON.stringify({ scripts: { dev: "next dev", build: "next build", start: "next start" }, dependencies: { next: "16.2.6", react: "19.1.0", "react-dom": "19.1.0" }, devDependencies: { "@types/node": "^22", "@types/react": "^19", typescript: "^5" } }, null, 2),
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "next.config.mjs": "const nextConfig={};\nexport default nextConfig;\n",
    "app/layout.tsx": `import type { ReactNode } from "react";\nimport "./globals.css";\nexport const metadata={title:${JSON.stringify(spec.brandName)},description:${JSON.stringify(spec.description)}};\nexport default function RootLayout({children}:{children:ReactNode}){return <html lang="ru"><body>{children}</body></html>}\n`,
    "app/page.tsx": page,
    "app/globals.css": css,
    "app/api/lead/route.ts": leadRoute,
    ".gitignore": ".next\nnode_modules\n.env*\n",
    "README.md": `# ${spec.brandName}\n\nStaging source generated by Khasroy Web Studio. Production deployment is intentionally separate.\n`,
    ".khasroy/staging.json": JSON.stringify(provenance, null, 2),
  } as Record<string, string>;
}

async function github(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "request_failed";
    throw new Error(`github_${response.status}:${message}`);
  }
  return (data || {}) as Record<string, any>;
}

async function commitFiles(repoFullName: string, token: string, files: Record<string, string>) {
  const ref = await github(`/repos/${repoFullName}/git/ref/heads/main`, token);
  const parentSha = String(ref.object?.sha || "");
  if (!parentSha) throw new Error("github_main_ref_missing");
  const parent = await github(`/repos/${repoFullName}/git/commits/${parentSha}`, token);
  const baseTree = String(parent.tree?.sha || "");
  const blobs = await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = await github(`/repos/${repoFullName}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "utf-8" }),
    });
    return { path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await github(`/repos/${repoFullName}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: blobs }),
  });
  const commit = await github(`/repos/${repoFullName}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message: "feat: export verified Khasroy staging site", tree: tree.sha, parents: [parentSha] }),
  });
  await github(`/repos/${repoFullName}/git/refs/heads/main`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return String(commit.sha || "");
}

export async function createGitHubStagingRepo(args: { token: string; spec: WebStudioSpec; projectSlug: string }) {
  const user = await github("/user", args.token);
  const login = String(user.login || "");
  if (!login) throw new Error("github_user_missing");

  const base = normalizeGitHubRepoName(args.projectSlug || args.spec.slug || args.spec.projectName);
  let repoName = `${base}-staging`.slice(0, 90);
  let repo: Record<string, any>;
  try {
    repo = await github("/user/repos", args.token, {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        description: `${args.spec.brandName} — Khasroy Web Studio staging`,
        private: true,
        auto_init: true,
      }),
    });
  } catch (error) {
    if (!/github_422/iu.test(String(error))) throw error;
    repoName = `${base.slice(0, 72)}-staging-${Date.now().toString(36).slice(-5)}`;
    repo = await github("/user/repos", args.token, {
      method: "POST",
      body: JSON.stringify({
        name: repoName,
        description: `${args.spec.brandName} — Khasroy Web Studio staging`,
        private: true,
        auto_init: true,
      }),
    });
  }

  const repoFullName = String(repo.full_name || `${login}/${repoName}`);
  await new Promise((resolve) => setTimeout(resolve, 650));
  const files = renderGitHubStagingProject(args.spec, args.projectSlug);
  const commitSha = await commitFiles(repoFullName, args.token, files);
  const fingerprint = createHash("sha256")
    .update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => `${path}\0${content}`).join("\0"))
    .digest("hex")
    .slice(0, 16);

  return {
    repoFullName,
    repoName,
    repoUrl: String(repo.html_url || `https://github.com/${repoFullName}`),
    commitSha,
    fingerprint,
    private: repo.private !== false,
    target: "github-staging" as const,
    productionUntouched: true,
  };
}
