import { createHmac, randomUUID } from "node:crypto";
import { recallKnowledge, rememberKnowledge } from "@/lib/server-memory";
import {
  createSiteAgentJob as createV6Job,
  stepSiteAgentJob as stepV6Job,
  extractSiteUrl,
  type SiteAgentJobResponse,
} from "@/lib/site-agent-job-v6";

export { extractSiteUrl };
export type { SiteAgentJobResponse };

const MEMORY_TIMEOUT = 12_000;
const FETCH_TIMEOUT = 10_000;
const MAX_HTML = 40_000;
const MAX_BUNDLE = 1_200_000;

type VisualScores = { visual: number; trust: number; conversion: number; mobile: number; overall: number };
type ViewCompare = { after: VisualScores; improved: boolean; regressions: string[]; remainingProblems: string[] };
type RepairRecord = { iteration: number; before: number; after: number; improved: boolean; problems: string[] };
type StoredJob = {
  id: string;
  targetUrl: string;
  origin: string;
  stage: string;
  updatedAt: string;
  previewUrl?: string;
  previewMobile?: string;
  previewDesktop?: string;
  comparison?: { before: VisualScores; after: VisualScores; overallDelta: number; improved: boolean; regressions: string[]; remainingProblems: string[] };
  success?: boolean;
  content?: string;
  siteIntel?: {
    repairIteration?: number;
    repairPreviousMobile?: string;
    repairPreviousDesktop?: string;
    repairBaseline?: VisualScores;
    repairHistory?: RepairRecord[];
    v6?: { targetedRepairs?: number; thirdPassForced?: boolean; [key: string]: unknown };
    v7?: { finalPassForced?: boolean; heroAssetRecovered?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function key(id: string) { return `site_agent_job_${id}`; }
function timeout(ms: number) { return AbortSignal.timeout(ms); }
async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function loadJob(ownerKey: string, id: string): Promise<StoredJob> {
  const items = await withDeadline(recallKnowledge(ownerKey, key(id), 10), MEMORY_TIMEOUT, "memory load");
  const item = items.find((x) => x.memory_key === key(id) && x.category === "site_agent_job");
  if (!item) throw new Error("Site Agent job не найден.");
  return JSON.parse(item.content) as StoredJob;
}
async function saveJob(ownerKey: string, job: StoredJob) {
  job.updatedAt = new Date().toISOString();
  await withDeadline(rememberKnowledge(ownerKey, key(job.id), "site_agent_job", JSON.stringify(job), 1), MEMORY_TIMEOUT, "memory save");
}
function sign(ownerKey: string, id: string, expires: number) { return createHmac("sha256", ownerKey).update(`${id}.${expires}`).digest("hex"); }
async function savePreview(ownerKey: string, origin: string, html: string) {
  const id = randomUUID();
  await withDeadline(rememberKnowledge(ownerKey, `site_demo_${id}`, "site_agent_demo", html.slice(0, MAX_HTML), 1), MEMORY_TIMEOUT, "preview save");
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return `${origin}/api/site-preview?id=${encodeURIComponent(id)}&expires=${expires}&sig=${sign(ownerKey, id, expires)}`;
}
function mshot(url: string, width: number, height: number) { return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${width}&h=${height}`; }
async function fetchText(url: string, limit = MAX_HTML) {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: timeout(FETCH_TIMEOUT), headers: { "user-agent": "Khasroy-Visual-Repair/7.0" } });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
    return { url: response.url || url, type: response.headers.get("content-type") || "", text: (await response.text()).slice(0, limit) };
  } catch { return null; }
}
function sameOrigin(raw: string, base: string) {
  try { const u = new URL(raw, base); const b = new URL(base); return /^https?:$/u.test(u.protocol) && u.hostname === b.hostname ? u.toString() : null; }
  catch { return null; }
}
function attr(tag: string, name: string) { return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "iu"))?.[1] || ""; }
function unique(values: string[], limit = 30) {
  const seen = new Set<string>(); const out: string[] = [];
  for (const value of values) { const v = value.trim(); const k = v.toLowerCase(); if (!v || seen.has(k)) continue; seen.add(k); out.push(v); if (out.length >= limit) break; }
  return out;
}
function assetScore(url: string) {
  let score = 0; const lower = url.toLowerCase();
  if (/(hero|banner|roof|house|home|facade|krov|кров|фасад)/iu.test(lower)) score += 12;
  if (/\.(?:webp|avif)$/iu.test(lower)) score += 4;
  if (/(logo|icon|favicon|sprite|avatar)/iu.test(lower)) score -= 20;
  return score;
}
async function discoverHeroAsset(targetUrl: string) {
  const home = await fetchText(targetUrl, 350_000); if (!home || !/text\/html/iu.test(home.type)) return "";
  const candidates: string[] = [];
  for (const tag of home.text.match(/<meta\b[^>]*>/giu) || []) {
    const property = `${attr(tag, "property")} ${attr(tag, "name")}`.toLowerCase();
    if (!/(og:image|twitter:image)/u.test(property)) continue;
    const raw = attr(tag, "content"); try { candidates.push(new URL(raw, home.url).toString()); } catch { /* ignore */ }
  }
  for (const tag of home.text.match(/<img\b[^>]*>/giu) || []) {
    const raw = attr(tag, "src") || attr(tag, "data-src"); if (!raw) continue;
    try { candidates.push(new URL(raw, home.url).toString()); } catch { /* ignore */ }
  }
  const scripts: string[] = [];
  for (const tag of home.text.match(/<script\b[^>]*src=["'][^"']+["'][^>]*>/giu) || []) {
    const script = sameOrigin(attr(tag, "src"), home.url); if (script && !scripts.includes(script)) scripts.push(script); if (scripts.length >= 5) break;
  }
  const results = await Promise.allSettled(scripts.map((url) => fetchText(url, MAX_BUNDLE)));
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const match of result.value.text.matchAll(/["'`]((?:https?:\/\/[^"'`\\\s]+|\/[^"'`\\\s]+)\.(?:webp|avif|png|jpe?g)(?:\?[^"'`\\\s]*)?)["'`]/giu)) {
      try { candidates.push(new URL(match[1], home.url).toString()); } catch { /* ignore */ }
      if (candidates.length >= 80) break;
    }
  }
  return unique(candidates, 60).sort((a, b) => assetScore(b) - assetScore(a))[0] || "";
}
function currentProblems(job: StoredJob) {
  const values = [...(job.comparison?.regressions || []), ...(job.comparison?.remainingProblems || [])];
  const seen = new Set<string>();
  return values.filter((value) => { const k = value.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
}
function escapeAttr(value: string) { return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;"); }
function repairCss(problems: string[]) {
  const text = problems.join(" ").toLowerCase();
  const rules = [
    "html,body{width:100%!important;max-width:100%!important;overflow-x:hidden!important}",
    ".wrap{margin-left:auto!important;margin-right:auto!important;min-width:0!important}",
    ".hero,.hero>div,.section,.sectionHead,.grid,.contact,.trust,.product,.pc,.heroVisual{min-width:0!important;max-width:100%!important}",
    ".hero>div:first-child,h1,.lead{position:relative!important;left:auto!important;right:auto!important;transform:none!important;text-indent:0!important;margin-left:0!important;padding-left:0!important;translate:none!important}",
    "h1,.lead{width:100%!important;max-width:100%!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;overflow-wrap:break-word!important;word-break:normal!important}",
    ".heroVisual .stamp{display:none!important}",
  ];
  if (/(clip|crop|cut off|truncat|partially visible|screen edge|left side|обрез|вылез)/iu.test(text)) {
    rules.push(".hero{overflow:visible!important}.hero>div:first-child{overflow:visible!important;width:100%!important}.actions,.grid{overflow:visible!important;max-width:100%!important}");
  }
  if (/(sparse|empty dark space|empty space|large amount of empty|whitespace|пуст)/iu.test(text)) {
    rules.push(".hero{min-height:auto!important;padding-top:34px!important;padding-bottom:34px!important}.section{padding-top:42px!important;padding-bottom:42px!important}.heroVisual{min-height:220px!important}");
  }
  if (/(cta|button|contrast|weak|blend|visibility|touch target|кноп)/iu.test(text)) {
    rules.push(".btn:not(.ghost),.quote,.mobile-cta{background:#f4fbff!important;color:#061018!important;border:1px solid #ffffff!important;box-shadow:0 8px 26px rgba(0,0,0,.24)!important;font-weight:900!important;opacity:1!important}.ghost{background:rgba(255,255,255,.08)!important;color:#ffffff!important;border:1px solid rgba(255,255,255,.55)!important;opacity:1!important}");
  }
  if (/(card|affordance|barely visible|content cards|карточ)/iu.test(text)) {
    rules.push(".product{border-color:rgba(255,255,255,.2)!important;background:#0f202a!important}.pc a{display:inline-flex!important;min-height:42px!important;align-items:center!important;color:#ffffff!important;font-weight:800!important}");
  }
  rules.push("@media(max-width:820px){.wrap{width:calc(100% - 32px)!important}.hero{grid-template-columns:minmax(0,1fr)!important;min-height:auto!important;padding:24px 0 30px!important;gap:18px!important}.hero h1{font-size:clamp(30px,9.2vw,38px)!important;line-height:1.06!important;letter-spacing:-.025em!important;margin:12px 0 16px!important}.lead{font-size:15.5px!important;line-height:1.52!important}.actions{display:grid!important;grid-template-columns:1fr!important;width:100%!important;gap:10px!important;margin-top:20px!important}.btn,.quote,.mobile-cta{min-height:50px!important;padding:14px 16px!important;white-space:normal!important;text-align:center!important}.heroVisual{height:220px!important;min-height:220px!important}.section{padding:34px 0!important}.grid{grid-template-columns:minmax(0,1fr)!important}.sectionHead h2,.trust h2,.contact h2{font-size:27px!important}.trust,.contact{padding:22px!important}}" );
  return rules.join("");
}
function patchLabels(html: string, problems: string[]) {
  if (!/(catalog|product list|less descriptive|solutions|каталог)/iu.test(problems.join(" "))) return html;
  return html.replace(/>Our Solutions</gu, ">Каталог<").replace(/>Наши решения</gu, ">Каталог<").replace(/>Решения</gu, ">Каталог<");
}
function injectHeroImage(html: string, heroAsset: string) {
  if (!heroAsset) return { html, injected: false };
  const match = html.match(/<div class="heroVisual">([\s\S]*?)<\/div>/iu);
  if (!match || /<img\b/iu.test(match[1])) return { html, injected: false };
  const image = `<img src="${escapeAttr(heroAsset)}" alt="" loading="eager" style="width:100%;height:100%;object-fit:cover">`;
  return { html: html.replace('<div class="heroVisual">', `<div class="heroVisual">${image}`), injected: true };
}
function patchPreview(html: string, problems: string[], heroAsset: string) {
  let next = patchLabels(html, problems);
  const injected = injectHeroImage(next, heroAsset); next = injected.html;
  const css = `<style data-khasroy-targeted-repair="v7">${repairCss(problems)}</style>`;
  next = next.includes("</head>") ? next.replace("</head>", `${css}</head>`) : `${css}${next}`;
  return { html: next, heroInjected: injected.injected };
}
async function targetedRepair(ownerKey: string, job: StoredJob) {
  if (!job.previewUrl || !job.previewMobile || !job.previewDesktop || !job.comparison?.after) throw new Error("targeted repair missing preview state");
  const preview = await fetchText(job.previewUrl, MAX_HTML); if (!preview || !/<html|<!doctype/iu.test(preview.text)) throw new Error("preview HTML invalid");
  const intel = job.siteIntel || {}; const v6 = intel.v6 || {}; const v7 = intel.v7 || {};
  const iteration = (intel.repairIteration || 0) + 1; const problems = currentProblems(job);
  const wantsVisual = /(hero image|image placeholder|empty hero|visual appeal|изображ|картин|placeholder)/iu.test(problems.join(" "));
  const heroAsset = wantsVisual || !/<div class="heroVisual">[\s\S]{0,500}<img\b/iu.test(preview.text) ? await discoverHeroAsset(job.targetUrl) : "";
  const patched = patchPreview(preview.text, problems, heroAsset);

  intel.repairPreviousMobile = job.previewMobile;
  intel.repairPreviousDesktop = job.previewDesktop;
  intel.repairBaseline = { ...job.comparison.after };
  intel.repairIteration = iteration;
  v6.targetedRepairs = (v6.targetedRepairs || 0) + 1;
  if (patched.heroInjected) v7.heroAssetRecovered = true;
  intel.v6 = v6; intel.v7 = v7;

  job.previewUrl = await savePreview(ownerKey, job.origin, patched.html);
  job.previewMobile = mshot(job.previewUrl, 390, 844);
  job.previewDesktop = mshot(job.previewUrl, 1280, 900);
  job.siteIntel = intel; job.stage = "REPAIR_WARM";
  await saveJob(ownerKey, job);
  return { iteration, problems, heroInjected: patched.heroInjected };
}
function rewrite(content: string | undefined, job: StoredJob) {
  if (!content) return content;
  const hero = job.siteIntel?.v7?.heroAssetRecovered ? " · recovered real hero asset" : "";
  return content.replace(/Site Intelligence v6/gu, "Site Intelligence v7") + `\n\n_Targeted Repair v7 · persistent clipping/CTA/layout guard${hero}._`;
}

export async function createSiteAgentJob(args: { ownerKey: string; origin: string; targetUrl: string; goal?: string }): Promise<SiteAgentJobResponse> {
  const result = await createV6Job(args);
  return { ...result, progress: "01/21 · Site Intelligence v7: calibrated judge + resilient targeted repair + real hero asset recovery." };
}

export async function stepSiteAgentJob(args: { ownerKey: string; apiKey: string; jobId: string }): Promise<SiteAgentJobResponse> {
  let job = await loadJob(args.ownerKey, args.jobId);

  if (job.stage === "REPAIR_PLAN" && job.previewUrl && job.comparison?.after) {
    const repaired = await targetedRepair(args.ownerKey, job);
    return { jobId: job.id, stage: "REPAIR_WARM", done: false, progress: `16/21 · Targeted repair ${repaired.iteration}: фиксирую clipping/CTA/mobile layout${repaired.heroInjected ? " и восстановил реальное hero-изображение" : ""}.`, retryAfterMs: 300 };
  }

  const result = await stepV6Job(args);
  job = await loadJob(args.ownerKey, args.jobId).catch(() => job);
  const intel = job.siteIntel || {}; const repairs = intel.repairHistory || []; const remaining = job.comparison?.remainingProblems || [];
  const v7 = intel.v7 || {};

  // A formally VERIFIED delta must not suppress a final repair when the visual judge
  // still reports concrete visible defects. Intercept before VERIFY_SKILLS can run.
  if ((job.stage === "VERIFY_SKILLS" || (result.done && job.stage === "DONE")) && repairs.length === 2 && remaining.length > 0 && !v7.finalPassForced && job.previewUrl) {
    v7.finalPassForced = true; intel.v7 = v7; job.siteIntel = intel; job.stage = "REPAIR_PLAN"; await saveJob(args.ownerKey, job);
    return { jobId: job.id, stage: "REPAIR_PLAN", done: false, progress: `19/21 · Улучшение уже подтверждено, но judge видит ещё ${remaining.length} дефектов. Запускаю обязательный третий targeted repair до верификации.`, retryAfterMs: 120 };
  }

  return { ...result, progress: result.progress.replace(/^(\d{2})\/20/u, (_, n) => `${String(Math.min(21, Number(n) + 1)).padStart(2, "0")}/21`), content: rewrite(result.content, job) };
}
