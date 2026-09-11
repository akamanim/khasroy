import { createHmac, randomUUID } from "node:crypto";
import { recallKnowledge, rememberKnowledge, upsertSkill } from "@/lib/server-memory";
import {
  createSiteAgentJob as createBaseJob,
  stepSiteAgentJob as stepBaseJob,
  extractSiteUrl,
  type VisualScores,
} from "@/lib/site-agent-job";

export { extractSiteUrl };

export type SiteAgentJobResponse = {
  jobId: string;
  stage: string;
  done: boolean;
  progress: string;
  retryAfterMs?: number;
  content?: string;
};

type Finding = { severity: "high" | "medium" | "low"; category: string; problem: string; evidence: string; fix: string };
type SiteContext = {
  source: "html" | "fallback";
  brandName: string;
  title: string;
  description: string;
  headings: string[];
  navLabels: string[];
  ctas: string[];
  contacts: string[];
  productTerms: string[];
  images: Array<{ src: string; alt: string }>;
  colors: string[];
  signalCount: number;
};
type ViewCompare = { after: VisualScores; improved: boolean; regressions: string[]; remainingProblems: string[] };
type StoredJob = {
  id: string;
  targetUrl: string;
  origin: string;
  stage: string;
  updatedAt: string;
  audit?: { summary: string; scores: VisualScores; findings: Finding[] };
  previewUrl?: string;
  previewMobile?: string;
  previewDesktop?: string;
  mobileCompare?: ViewCompare;
  desktopCompare?: ViewCompare;
  comparison?: { before: VisualScores; after: VisualScores; overallDelta: number; improved: boolean; regressions: string[] };
  success?: boolean;
  content?: string;
  siteIntel?: {
    context?: SiteContext;
    rawScores?: VisualScores;
    calibrationApplied?: boolean;
    verifyIndex?: number;
  };
  [key: string]: unknown;
};

const V2_SKILLS = [
  ["site_business_context_extraction", "Site Business Context Extraction", "Reads real public site content, products, CTAs, contacts, imagery and brand signals before redesign."],
  ["brand_aware_redesign", "Brand-Aware Redesign", "Builds redesigns from the target business's real categories and content instead of a generic template."],
  ["calibrated_visual_scoring", "Calibrated Visual Scoring", "Uses anchored 0–100 scoring with evidence-based calibration to avoid absurd visual scores."],
] as const;

function key(id: string) { return `site_agent_job_${id}`; }
function clip(value: string, max = 150) { const v = value.replace(/\s+/g, " ").trim(); return v.length > max ? `${v.slice(0, max - 1).trim()}…` : v; }
function unique(values: string[], limit = 12) { return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, limit); }
function esc(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function severityWeight(value: string) { return value === "high" ? 10 : value === "medium" ? 6 : 3; }
function mshot(url: string, width: number, height: number) { return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${width}&h=${height}`; }

async function loadJob(ownerKey: string, id: string): Promise<StoredJob> {
  const items = await recallKnowledge(ownerKey, key(id), 10);
  const item = items.find((x) => x.memory_key === key(id) && x.category === "site_agent_job");
  if (!item) throw new Error("Site Agent job не найден.");
  return JSON.parse(item.content) as StoredJob;
}
async function saveJob(ownerKey: string, job: StoredJob) {
  job.updatedAt = new Date().toISOString();
  await rememberKnowledge(ownerKey, key(job.id), "site_agent_job", JSON.stringify(job), 1);
}
function decode(value: string) {
  return value.replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">");
}
function strip(value: string) { return clip(decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/g, " ")), 180); }
function attr(tag: string, name: string) { return decode(tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "iu"))?.[1] || "").trim(); }
function meta(html: string, keyName: string) {
  for (const tag of html.match(/<meta\b[^>]*>/giu) || []) {
    const name = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (name === keyName.toLowerCase()) return clip(attr(tag, "content"), 220);
  }
  return "";
}
function fallbackContext(url: string): SiteContext {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return { source: "fallback", brandName: host, title: host, description: "", headings: [], navLabels: [], ctas: [], contacts: [], productTerms: [], images: [], colors: [], signalCount: 1 };
}
async function extractContext(url: string): Promise<SiteContext> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Mozilla/5.0 Khasroy-Site-Intelligence/2.0" } });
  } catch { return fallbackContext(url); }
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !/text\/html|application\/xhtml\+xml/iu.test(contentType)) { await response.body?.cancel().catch(() => undefined); return fallbackContext(url); }
  const html = (await response.text()).slice(0, 450_000);
  const title = clip(strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || ""), 180);
  const description = meta(html, "description") || meta(html, "og:description");
  const siteName = meta(html, "og:site_name");
  const headings = unique([...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/giu)].map((m) => strip(m[1])).filter((v) => v.length >= 3), 14);
  const navHtml = [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/giu)].map((m) => m[1]).join(" ");
  const navLabels = unique(((navHtml || html).match(/<a\b[^>]*>[\s\S]*?<\/a>/giu) || []).map(strip).filter((v) => v.length >= 2 && v.length <= 45), 12);
  const ctas = unique((html.match(/<(?:button|a)\b[^>]*>[\s\S]*?<\/(?:button|a)>/giu) || []).map(strip).filter((v) => /(получ|заказ|куп|рассчит|связ|позвон|напис|остав|консульта|подробнее|узнать|whatsapp|telegram|order|quote|contact|call|buy)/iu.test(v)), 8);
  const phones = unique((html.match(/(?:\+?996|0)[\s()\-]?\d{3}[\s()\-]?\d{2,3}[\s\-]?\d{2}[\s\-]?\d{2}/gu) || []).map((v) => v.replace(/\s+/g, " ")), 4);
  const emails = unique(html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) || [], 4);
  const messengers = unique((html.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com|t\.me)\/[^"'\s<>]+/giu) || []).map((v) => v.replace(/&amp;/g, "&")), 4);
  const contacts = unique([...phones, ...emails, ...messengers], 8);
  const images: Array<{ src: string; alt: string }> = [];
  for (const tag of html.match(/<img\b[^>]*>/giu) || []) {
    const raw = attr(tag, "src") || attr(tag, "data-src"); if (!raw || /^data:/iu.test(raw)) continue;
    try { const src = new URL(raw, url); if (["http:", "https:"].includes(src.protocol)) images.push({ src: src.toString(), alt: clip(attr(tag, "alt"), 80) }); } catch { /* ignore */ }
    if (images.length >= 8) break;
  }
  const colors = unique((html.match(/#[0-9a-f]{6}\b/giu) || []).map((v) => v.toLowerCase()).filter((v) => !["#ffffff", "#000000"].includes(v)), 6);
  const generic = /^(главная|о нас|контакты|каталог|услуги|продукция|подробнее|меню|home|about|contact|catalog)$/iu;
  const productTerms = unique([...headings, ...navLabels].filter((v) => v.length >= 3 && v.length <= 55 && !generic.test(v)), 10);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const brandName = clip(siteName || title.split(/\s[|—–-]\s/)[0] || host, 70) || host;
  const signalCount = [title, description, ...headings.slice(0, 4), ...productTerms.slice(0, 4), ...contacts.slice(0, 2), ...colors.slice(0, 2)].filter(Boolean).length;
  return { source: "html", brandName, title: title || brandName, description, headings, navLabels, ctas, contacts, productTerms, images, colors, signalCount: Math.max(1, signalCount) };
}

function calibrateScores(raw: VisualScores, findings: Finding[]): VisualScores {
  const general = Math.min(46, findings.reduce((sum, f) => sum + severityWeight(f.severity), 0));
  const mobilePenalty = Math.min(30, findings.filter((f) => /(mobile|responsive|overflow|viewport|мобил|адаптив)/iu.test(`${f.category} ${f.problem}`)).reduce((sum, f) => sum + severityWeight(f.severity), 0));
  const conversionPenalty = Math.min(28, findings.filter((f) => /(cta|conversion|contact|button|конверс|кноп|контакт)/iu.test(`${f.category} ${f.problem}`)).reduce((sum, f) => sum + severityWeight(f.severity), 0));
  const targets = { visual: clamp(84 - general), trust: clamp(82 - Math.round(general * 0.6)), conversion: clamp(82 - Math.round(general * 0.45) - conversionPenalty), mobile: clamp(86 - Math.round(general * 0.35) - mobilePenalty) };
  const blend = (value: number, target: number) => { const bounded = Math.max(target - 18, Math.min(target + 18, value)); return clamp((bounded + target) / 2); };
  const visual = blend(raw.visual, targets.visual), trust = blend(raw.trust, targets.trust), conversion = blend(raw.conversion, targets.conversion), mobile = blend(raw.mobile, targets.mobile);
  return { visual, trust, conversion, mobile, overall: Math.round((visual + trust + conversion + mobile) / 4) };
}
function calibrateAfter(after: VisualScores, before: VisualScores): VisualScores {
  const plausible = (value: number, base: number) => clamp(Math.max(base - 25, Math.min(base + 30, value)));
  const visual = plausible(after.visual, before.visual), trust = plausible(after.trust, before.trust), conversion = plausible(after.conversion, before.conversion), mobile = plausible(after.mobile, before.mobile);
  return { visual, trust, conversion, mobile, overall: Math.round((visual + trust + conversion + mobile) / 4) };
}

function validHex(value: string | undefined, fallback: string) { return value && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback; }
function artifactSignature(ownerKey: string, id: string, expires: number) { return createHmac("sha256", ownerKey).update(`${id}.${expires}`).digest("hex"); }
async function savePreview(ownerKey: string, origin: string, html: string) {
  const id = randomUUID(); await rememberKnowledge(ownerKey, `site_demo_${id}`, "site_agent_demo", html.slice(0, 14_500), 1);
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return `${origin}/api/site-preview?id=${encodeURIComponent(id)}&expires=${expires}&sig=${artifactSignature(ownerKey, id, expires)}`;
}
function brandAwareHtml(job: StoredJob, context: SiteContext) {
  const audit = job.audit!; const brand = context.brandName || new URL(job.targetUrl).hostname.replace(/^www\./, "");
  const heroTitle = clip(context.headings.find((h) => h.length >= 12 && h.length <= 100) || context.title || `Предложение ${brand}`, 105);
  const description = clip(context.description || context.headings.find((h) => h !== heroTitle) || `Понятная структура каталога и быстрый путь к заказу у ${brand}.`, 180);
  const cta = clip(context.ctas[0] || (context.contacts.length ? "Связаться и получить предложение" : "Получить предложение"), 45);
  const terms = (context.productTerms.length ? context.productTerms : context.headings).slice(0, 6);
  const sections = terms.length ? terms : ["Предложение", "Преимущества", "Контакт"];
  const accent = validHex(context.colors[0], "#35b7d4"), accent2 = validHex(context.colors[1], "#d9f8ff");
  const nav = context.navLabels.slice(0, 5).map((n) => `<span>${esc(n)}</span>`).join("");
  const cards = sections.map((term, i) => `<article class="card">${context.images[i]?.src ? `<img src="${esc(context.images[i].src)}" alt="${esc(term)}">` : `<div class="visual">${String(i + 1).padStart(2, "0")}</div>`}<div class="body"><small>${esc(term)}</small><h3>${esc(term)}</h3><p>Сохраняем реальное направление сайта и делаем его заметным в коммерческой структуре.</p></div></article>`).join("");
  const priorities = audit.findings.slice(0, 3).map((f) => `<li>${esc(f.fix || f.problem)}</li>`).join("");
  const contact = context.contacts[0] || "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand)} — redesign</title><style>:root{--bg:#081119;--panel:#0f1c25;--text:#f2f7fa;--muted:#9fb0bb;--line:#263b47;--a:${accent};--a2:${accent2}}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 78% 0,color-mix(in srgb,var(--a) 16%,transparent),transparent 34%),var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif}.wrap{width:min(1160px,calc(100% - 36px));margin:auto}.nav{min-height:74px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);gap:20px}.brand{font-weight:900}.links{display:flex;gap:16px;color:var(--muted);font-size:13px}.hero{min-height:590px;display:grid;grid-template-columns:1.18fr .82fr;gap:46px;align-items:center;padding:66px 0}.k{color:var(--a2);font-size:12px;letter-spacing:.15em;text-transform:uppercase}.hero h1{font-size:clamp(42px,6vw,76px);line-height:1;letter-spacing:-.055em;margin:16px 0 20px}.hero p{color:var(--muted);font-size:18px;line-height:1.65}.btn{display:inline-flex;margin-top:22px;padding:14px 19px;border-radius:13px;background:var(--a2);color:#07131a;text-decoration:none;font-weight:850}.audit{border:1px solid var(--line);border-radius:24px;padding:28px;background:#101d26}.audit strong{display:block;font-size:64px;line-height:1}.audit span,.audit li{color:var(--muted)}.head{display:flex;justify-content:space-between;gap:24px;align-items:end;margin:25px 0}.head h2{font-size:34px;margin:0}.head p{color:var(--muted);max-width:580px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{overflow:hidden;border:1px solid var(--line);border-radius:19px;background:var(--panel)}.card img,.visual{width:100%;height:150px;object-fit:cover;background:linear-gradient(135deg,color-mix(in srgb,var(--a) 28%,#10212b),#0a151d);display:grid;place-items:center;font-size:44px;font-weight:900}.body{padding:22px}.body small{color:var(--a2)}.body p{color:var(--muted);line-height:1.55}.cta{margin:66px 0 42px;padding:38px;border:1px solid var(--line);border-radius:24px;background:#11242e;display:flex;align-items:center;justify-content:space-between;gap:24px}.cta p{color:var(--muted)}footer{padding:28px 0 42px;border-top:1px solid var(--line);color:#718793;font-size:12px}@media(max-width:800px){.wrap{width:calc(100% - 24px)}.links{display:none}.hero{grid-template-columns:1fr;min-height:auto;padding:48px 0}.hero h1{font-size:43px}.grid{grid-template-columns:1fr}.cta{flex-direction:column;align-items:flex-start}}</style></head><body><div class="wrap"><nav class="nav"><div class="brand">${esc(brand)}</div><div class="links">${nav}</div></nav><main><section class="hero"><div><div class="k">${esc(context.productTerms.slice(0, 3).join(" · ") || "РЕАЛЬНЫЙ КОНТЕНТ · НОВАЯ ИЕРАРХИЯ")}</div><h1>${esc(heroTitle)}</h1><p>${esc(description)}</p><a class="btn" href="#contact">${esc(cta)}</a></div><aside class="audit"><span>Калиброванный исходный аудит</span><strong>${audit.scores.overall}</strong><span>из 100</span><ul>${priorities}</ul></aside></section><section><div class="head"><h2>Реальные направления сайта</h2><p>Хасрой сохраняет товары и смысл бизнеса, меняя иерархию, подачу и путь к действию.</p></div><div class="grid">${cards}</div></section><section class="cta" id="contact"><div><h2>${esc(`Связаться с ${brand}`)}</h2><p>${esc(contact || "Следующий шаг без выдуманных отзывов, цифр и сертификатов.")}</p></div><a class="btn" href="#">${esc(cta)}</a></section></main><footer>Khasroy Site Intelligence v2 · real business context · calibrated scoring</footer></div></body></html>`;
}

function enrichedContent(job: StoredJob, context: SiteContext) {
  const raw = job.siteIntel?.rawScores?.overall;
  const calibrated = job.audit?.scores.overall;
  const after = job.comparison?.after.overall;
  const delta = job.comparison?.overallDelta;
  return [
    `## Site Agent v2 завершил аудит ${new URL(job.targetUrl).hostname}`, "",
    `**До:** ${calibrated ?? "—"}/100 · **После demo:** ${after ?? "—"}/100 · **Изменение:** ${typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${delta}` : "—"}`, "",
    typeof raw === "number" ? `_${raw}/100 — сырой score vision-модели; ${calibrated}/100 — калиброванный score evidence-anchor v2._` : "", "",
    "### Что Хасрой понял о бизнесе",
    `- **Бренд:** ${context.brandName}`,
    `- **Контент:** ${context.source === "html" ? "прочитан с реального сайта" : "fallback — HTML сайта не удалось прочитать"}`,
    `- **Направления:** ${context.productTerms.slice(0, 6).join(", ") || "не удалось уверенно выделить"}`,
    `- **Контакт:** ${context.contacts[0] || "не найден"}`, "",
    "### Выполнено", "- real business/content extraction", "- mobile + desktop screenshots", "- calibrated visual audit", "- brand-aware responsive demo", "- mobile + desktop before/after", `- repair loop: ${job.success ? "**VERIFIED — улучшение подтверждено**" : "**LEARNING — улучшение пока недостаточно**"}`, "",
    `### Demo\n[Открыть brand-aware редизайн](${job.previewUrl})`, "",
    `_Site Intelligence v2 · context signals: ${context.signalCount} · scoring: evidence_anchor_v2._`,
  ].filter(Boolean).join("\n");
}

async function verifyV2Skill(ownerKey: string, job: StoredJob, index: number) {
  const item = V2_SKILLS[index]; if (!item) return;
  const [slug, name, description] = item;
  await upsertSkill(ownerKey, { slug, name, description, status: "verified", level: 1, testsPassed: 1, testsFailed: 0, metadata: { testedAt: new Date().toISOString(), targetUrl: job.targetUrl, execution: "site_intelligence_v2_overlay", contextSource: job.siteIntel?.context?.source, contextSignals: job.siteIntel?.context?.signalCount, rawBeforeOverall: job.siteIntel?.rawScores?.overall, calibratedBeforeOverall: job.audit?.scores.overall, afterOverall: job.comparison?.after.overall, calibrationVersion: "evidence_anchor_v2" } });
}

export async function createSiteAgentJob(args: { ownerKey: string; origin: string; targetUrl: string; goal?: string }): Promise<SiteAgentJobResponse> {
  const base = await createBaseJob(args);
  return { ...base, progress: "Сначала читаю реальный контент, товары и бренд сайта." };
}

export async function stepSiteAgentJob(args: { ownerKey: string; apiKey: string; jobId: string }): Promise<SiteAgentJobResponse> {
  let job = await loadJob(args.ownerKey, args.jobId);
  const intel = job.siteIntel || {};

  if (!intel.context && job.stage !== "DONE") {
    intel.context = await extractContext(job.targetUrl);
    intel.verifyIndex = 0;
    job.siteIntel = intel;
    await saveJob(args.ownerKey, job);
    return { jobId: job.id, stage: job.stage, done: false, progress: intel.context.source === "html" ? `Понял бизнес: ${intel.context.brandName}. Продолжаю визуальный аудит.` : "HTML сайта не отдался, продолжаю с fallback-контекстом.", retryAfterMs: 100 };
  }

  if (job.stage === "DESIGN_DEMO") {
    const context = intel.context || fallbackContext(job.targetUrl);
    if (job.audit && !intel.calibrationApplied) {
      intel.rawScores = { ...job.audit.scores };
      job.audit.scores = calibrateScores(job.audit.scores, job.audit.findings || []);
      intel.calibrationApplied = true;
      job.siteIntel = intel;
    }
    const html = brandAwareHtml(job, context);
    job.previewUrl = await savePreview(args.ownerKey, job.origin, html);
    job.previewMobile = mshot(job.previewUrl, 390, 844);
    job.previewDesktop = mshot(job.previewUrl, 1280, 900);
    job.stage = "PREVIEW_WARM";
    await saveJob(args.ownerKey, job);
    return { jobId: job.id, stage: job.stage, done: false, progress: "Brand-aware demo создан из реального контента. Подготавливаю preview.", retryAfterMs: 300 };
  }

  if (job.stage === "DONE") {
    const context = intel.context || fallbackContext(job.targetUrl);
    if (job.success && context.source === "html" && context.signalCount >= 3 && (intel.verifyIndex || 0) < V2_SKILLS.length) {
      const index = intel.verifyIndex || 0;
      await verifyV2Skill(args.ownerKey, job, index);
      intel.verifyIndex = index + 1;
      job.siteIntel = intel;
      if (intel.verifyIndex >= V2_SKILLS.length) job.content = enrichedContent(job, context);
      await saveJob(args.ownerKey, job);
      return { jobId: job.id, stage: "VERIFY_SITE_INTELLIGENCE", done: false, progress: `Подтверждаю новые навыки Site Intelligence: ${intel.verifyIndex}/${V2_SKILLS.length}.`, retryAfterMs: 100 };
    }
    if (!job.content?.includes("Site Agent v2")) { job.content = enrichedContent(job, context); await saveJob(args.ownerKey, job); }
    return { jobId: job.id, stage: "DONE", done: true, progress: "Site Intelligence v2 завершён.", content: job.content };
  }

  const previousStage = job.stage;
  const result = await stepBaseJob(args);

  if (previousStage === "COMPARE_MOBILE" || previousStage === "COMPARE_DESKTOP") {
    job = await loadJob(args.ownerKey, args.jobId);
    const comparison = previousStage === "COMPARE_MOBILE" ? job.mobileCompare : job.desktopCompare;
    if (comparison && job.audit) {
      comparison.after = calibrateAfter(comparison.after, job.audit.scores);
      comparison.improved = comparison.improved && comparison.after.overall > job.audit.scores.overall;
      await saveJob(args.ownerKey, job);
    }
  }

  if (previousStage === "FINALIZE") {
    job = await loadJob(args.ownerKey, args.jobId);
    const context = job.siteIntel?.context || fallbackContext(job.targetUrl);
    job.content = enrichedContent(job, context);
    await saveJob(args.ownerKey, job);
    return { ...result, content: result.done ? job.content : undefined };
  }

  if (result.done) {
    job = await loadJob(args.ownerKey, args.jobId);
    const context = job.siteIntel?.context || fallbackContext(job.targetUrl);
    job.content = enrichedContent(job, context);
    await saveJob(args.ownerKey, job);
    if (job.success && context.source === "html" && context.signalCount >= 3 && (job.siteIntel?.verifyIndex || 0) < V2_SKILLS.length) {
      return { jobId: job.id, stage: "VERIFY_SITE_INTELLIGENCE", done: false, progress: "Основной repair loop подтверждён. Проверяю новые Site Intelligence навыки.", retryAfterMs: 100 };
    }
    return { ...result, content: job.content };
  }

  return result;
}
