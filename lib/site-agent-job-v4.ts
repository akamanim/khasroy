import { recallKnowledge, rememberKnowledge } from "@/lib/server-memory";
import {
  createSiteAgentJob as createV3Job,
  stepSiteAgentJob as stepV3Job,
  extractSiteUrl,
  type SiteAgentJobResponse,
} from "@/lib/site-agent-job-v3";
import { stepSiteAgentJob as stepBaseJob, type VisualScores } from "@/lib/site-agent-job";

export { extractSiteUrl };
export type { SiteAgentJobResponse };

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "qwen/qwen3.6-27b";
const FETCH_TIMEOUT = 7_000;
const VISION_TIMEOUT = 25_000;
const MEMORY_TIMEOUT = 12_000;
const MAX_PAGES = 10;

type LinkEvidence = { label: string; url: string };
type ImageEvidence = { src: string; alt: string };
type PageEvidence = {
  url: string;
  title: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  links: LinkEvidence[];
  contacts: string[];
  images: ImageEvidence[];
};
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
  images: ImageEvidence[];
  colors: string[];
  pages: PageEvidence[];
  signalCount: number;
};
type BusinessCategory = { name: string; url?: string; summary?: string; image?: string };
type BusinessMap = {
  brandName: string;
  industry: string;
  primaryOffer: string;
  audience: string;
  categories: BusinessCategory[];
  benefits: string[];
  contacts: string[];
  primaryCta: string;
  evidence: string[];
};
type V4State = {
  deepCrawled?: boolean;
  visualFallbackUsed?: boolean;
  evidenceGatePassed?: boolean;
  routeCandidates?: number;
  artifactFiltered?: number;
};
type SiteIntel = {
  context?: SiteContext;
  businessMap?: BusinessMap;
  v4?: V4State;
  [key: string]: unknown;
};
type StoredJob = {
  id: string;
  targetUrl: string;
  goal?: string;
  origin: string;
  stage: string;
  updatedAt: string;
  originalMobile?: string;
  originalDesktop?: string;
  audit?: { summary: string; scores: VisualScores; findings: Array<{ problem: string; fix: string }> };
  success?: boolean;
  content?: string;
  siteIntel?: SiteIntel;
  [key: string]: unknown;
};
type GroqMessage = { role: "system" | "user"; content: string | Array<Record<string, unknown>> };

function jobKey(id: string) { return `site_agent_job_${id}`; }
function timeout(ms: number) { return AbortSignal.timeout(ms); }
function clip(value: string, max = 180) { const v = value.replace(/\s+/g, " ").trim(); return v.length > max ? `${v.slice(0, max - 1).trim()}…` : v; }
function decode(value: string) { return value.replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/&quot;/giu, '"').replace(/&#39;|&apos;/giu, "'").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">"); }
function strip(value: string, max = 180) { return clip(decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/g, " ")), max); }
function attr(tag: string, name: string) { return decode(tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "iu"))?.[1] || "").trim(); }
function unique(values: string[], limit = 20) { const seen = new Set<string>(); const out: string[] = []; for (const raw of values) { const v = clip(raw); const k = v.toLowerCase(); if (!v || seen.has(k)) continue; seen.add(k); out.push(v); if (out.length >= limit) break; } return out; }
function isArtifactText(value: string) {
  return /(bolt\.new|stackblitz|lovable|v0\.dev|vercel\s*(badge|toolbar)?|netlify|react devtools|edit\s+with|built\s+with|powered\s+by|design instructions?|clean,?\s*industrial aesthetic|prompt:|developer toolbar|preview mode)/iu.test(value);
}
function cleanStrings(values: string[], limit = 20) { return unique(values.filter((v) => !isArtifactText(v)), limit); }
function genericLabel(value: string) {
  return /^(главная|о нас|контакты|контакт|каталог|услуги|продукция|товары|подробнее|меню|home|about|contact|catalog|services|products|получить предложение|заказать|далее|назад)$/iu.test(value.trim());
}
function sameOrigin(raw: string, base: string) {
  try { const u = new URL(raw, base); const b = new URL(base); if (!/^https?:$/u.test(u.protocol) || u.hostname !== b.hostname) return null; u.hash = ""; return u.toString(); } catch { return null; }
}
function meta(html: string, name: string) {
  for (const tag of html.match(/<meta\b[^>]*>/giu) || []) { const n = (attr(tag, "name") || attr(tag, "property")).toLowerCase(); if (n === name.toLowerCase()) return clip(attr(tag, "content"), 240); }
  return "";
}
function contactsFromHtml(html: string) {
  const phones = html.match(/(?:\+?996|0)[\s()\-]?\d{3}[\s()\-]?\d{2,3}[\s\-]?\d{2}[\s\-]?\d{2}/gu) || [];
  const emails = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) || [];
  const messengers = html.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com|t\.me)\/[^"'\s<>]+/giu) || [];
  return cleanStrings([...phones, ...emails, ...messengers].map((v) => v.replace(/&amp;/g, "&")), 8);
}
async function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function loadJob(ownerKey: string, id: string): Promise<StoredJob> {
  const items = await withDeadline(recallKnowledge(ownerKey, jobKey(id), 10), MEMORY_TIMEOUT, "memory load");
  const item = items.find((x) => x.memory_key === jobKey(id) && x.category === "site_agent_job");
  if (!item) throw new Error("Site Agent job не найден.");
  return JSON.parse(item.content) as StoredJob;
}
async function saveJob(ownerKey: string, job: StoredJob) {
  job.updatedAt = new Date().toISOString();
  await withDeadline(rememberKnowledge(ownerKey, jobKey(job.id), "site_agent_job", JSON.stringify(job), 1), MEMORY_TIMEOUT, "memory save");
}
async function fetchText(url: string, accept = "text/html,application/xhtml+xml,*/*;q=.7") {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: timeout(FETCH_TIMEOUT), headers: { "user-agent": "Mozilla/5.0 Khasroy-Site-Intelligence/4.0", accept } });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
    const text = (await response.text()).slice(0, 650_000);
    return { url: response.url || url, type, text };
  } catch { return null; }
}
function pageFromHtml(url: string, html: string): PageEvidence {
  const titleRaw = strip(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || "", 180);
  const title = isArtifactText(titleRaw) ? "" : titleRaw;
  const descriptionRaw = meta(html, "description") || meta(html, "og:description");
  const description = isArtifactText(descriptionRaw) ? "" : descriptionRaw;
  const headings = cleanStrings([...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/giu)].map((m) => strip(m[1])).filter((v) => v.length >= 3), 14);
  const paragraphs = cleanStrings([...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map((m) => strip(m[1], 240)).filter((v) => v.length >= 24), 10);
  const links: LinkEvidence[] = [];
  for (const tag of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/giu) || []) {
    const href = sameOrigin(attr(tag, "href"), url); const label = strip(tag, 90);
    if (!href || !label || label.length > 80 || isArtifactText(label)) continue;
    if (!links.some((x) => x.url === href && x.label.toLowerCase() === label.toLowerCase())) links.push({ label, url: href });
    if (links.length >= 40) break;
  }
  const images: ImageEvidence[] = [];
  const ogImage = meta(html, "og:image");
  if (ogImage && !isArtifactText(ogImage)) { try { images.push({ src: new URL(ogImage, url).toString(), alt: title }); } catch { /* ignore */ } }
  for (const tag of html.match(/<img\b[^>]*>/giu) || []) {
    const raw = attr(tag, "src") || attr(tag, "data-src"); const alt = clip(attr(tag, "alt"), 100);
    if (!raw || /^data:/iu.test(raw) || isArtifactText(`${raw} ${alt}`)) continue;
    try { const src = new URL(raw, url); if (/^https?:$/u.test(src.protocol) && !images.some((x) => x.src === src.toString())) images.push({ src: src.toString(), alt }); } catch { /* ignore */ }
    if (images.length >= 8) break;
  }
  return { url, title, description, headings, paragraphs, links, contacts: contactsFromHtml(html), images };
}
function routeFromString(raw: string, base: string) {
  if (!raw.startsWith("/") || raw.startsWith("//") || /\.(?:js|css|map|png|jpg|jpeg|webp|svg|ico|woff2?|ttf|json|txt)$/iu.test(raw)) return null;
  if (/^\/(?:api|_next|assets|static|favicon|manifest)(?:\/|$)/iu.test(raw)) return null;
  if (raw.length > 100 || /[{}*:$]/u.test(raw)) return null;
  return sameOrigin(raw, base);
}
async function discoverRoutes(base: string, html: string, homeLinks: LinkEvidence[]) {
  const urls = new Set<string>();
  for (const link of homeLinks) { const u = sameOrigin(link.url, base); if (u) urls.add(u); }

  const sitemapUrls = [new URL("/sitemap.xml", base).toString()];
  const robots = await fetchText(new URL("/robots.txt", base).toString(), "text/plain,*/*");
  if (robots) for (const match of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gimu)) { try { sitemapUrls.push(new URL(match[1], base).toString()); } catch { /* ignore */ } }
  for (const sitemapUrl of unique(sitemapUrls, 3)) {
    const sitemap = await fetchText(sitemapUrl, "application/xml,text/xml,*/*");
    if (!sitemap) continue;
    for (const match of sitemap.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/giu)) { const u = sameOrigin(decode(match[1]), base); if (u) urls.add(u); if (urls.size >= 30) break; }
  }

  const scriptUrls: string[] = [];
  for (const tag of html.match(/<script\b[^>]*src=["'][^"']+["'][^>]*>/giu) || []) { const u = sameOrigin(attr(tag, "src"), base); if (u && !scriptUrls.includes(u)) scriptUrls.push(u); if (scriptUrls.length >= 4) break; }
  const scripts = await Promise.allSettled(scriptUrls.map((u) => fetchText(u, "text/javascript,*/*")));
  for (const result of scripts) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const js = result.value.text;
    for (const match of js.matchAll(/["'`](\/[A-Za-z0-9А-Яа-яЁё][^"'`\\\s]{1,90})["'`]/gu)) { const u = routeFromString(match[1], base); if (u) urls.add(u); if (urls.size >= 40) break; }
  }

  for (const path of ["/catalog", "/products", "/services", "/katalog", "/produkciya", "/uslugi", "/shop", "/portfolio", "/contacts"]) {
    const u = sameOrigin(path, base); if (u) urls.add(u);
  }
  urls.delete(new URL(base).toString());
  return [...urls];
}
function candidateScore(url: string, labels: LinkEvidence[]) {
  const path = new URL(url).pathname.toLowerCase(); const label = labels.find((x) => x.url === url)?.label || "";
  let score = genericLabel(label) ? 0 : 4;
  if (/(catalog|product|service|shop|katalog|produk|uslug|товар|каталог|продук|услуг)/iu.test(`${path} ${label}`)) score += 8;
  if (/(contact|about|privacy|policy|login|cart|checkout|контакт|о-нас)/iu.test(path)) score -= 5;
  const depth = path.split("/").filter(Boolean).length; if (depth >= 1 && depth <= 2) score += 3; if (depth > 4) score -= 3;
  return score;
}
async function deepCrawl(url: string): Promise<{ context: SiteContext; candidates: number; artifacts: number }> {
  const home = await fetchText(url); if (!home || !/text\/html|application\/xhtml\+xml/iu.test(home.type)) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return { context: { source: "fallback", brandName: host, title: host, description: "", headings: [], navLabels: [], ctas: [], contacts: [], productTerms: [], images: [], colors: [], pages: [], signalCount: 1 }, candidates: 0, artifacts: 0 };
  }
  const homePage = pageFromHtml(home.url, home.text); const routes = await discoverRoutes(home.url, home.text, homePage.links);
  const selected = routes.sort((a, b) => candidateScore(b, homePage.links) - candidateScore(a, homePage.links)).slice(0, MAX_PAGES - 1);
  const results = await Promise.allSettled(selected.map((u) => fetchText(u)));
  const pages = [homePage];
  for (const result of results) { if (result.status !== "fulfilled" || !result.value || !/text\/html|application\/xhtml\+xml/iu.test(result.value.type)) continue; const page = pageFromHtml(result.value.url, result.value.text); const signal = page.headings.length + page.paragraphs.length + page.contacts.length; if (signal >= 2 && !pages.some((p) => p.url === page.url)) pages.push(page); }
  const siteName = meta(home.text, "og:site_name"); const title = homePage.title;
  const brandName = clip((siteName && !isArtifactText(siteName) ? siteName : "") || title.split(/\s[|—–-]\s/)[0] || new URL(home.url).hostname.replace(/^www\./, ""), 70);
  const headings = cleanStrings(pages.flatMap((p) => p.headings), 32);
  const navLabels = cleanStrings(homePage.links.map((l) => l.label).filter((v) => !genericLabel(v)), 18);
  const ctas = cleanStrings(pages.flatMap((p) => p.links.map((l) => l.label)).filter((v) => /(заказ|куп|рассчит|связ|позвон|напис|остав|консульта|получ|подробнее|узнать|whatsapp|telegram|order|quote|contact|call|buy)/iu.test(v)), 12);
  const contacts = cleanStrings(pages.flatMap((p) => p.contacts), 10);
  const images = pages.flatMap((p) => p.images).filter((img, i, all) => !isArtifactText(`${img.src} ${img.alt}`) && all.findIndex((x) => x.src === img.src) === i).slice(0, 14);
  const generic = /^(главная|о нас|контакты|каталог|услуги|продукция|товары|подробнее|меню|home|about|contact|catalog|services|products)$/iu;
  const productTerms = cleanStrings([...pages.flatMap((p) => p.links.map((l) => l.label)), ...headings, ...images.map((i) => i.alt)].filter((v) => v.length >= 3 && v.length <= 70 && !generic.test(v) && !genericLabel(v) && v.toLowerCase() !== brandName.toLowerCase()), 20);
  const colors = cleanStrings((home.text.match(/#[0-9a-f]{6}\b/giu) || []).map((v) => v.toLowerCase()).filter((v) => !["#ffffff", "#000000"].includes(v)), 8);
  const description = homePage.description || pages.flatMap((p) => p.paragraphs)[0] || "";
  const signalCount = [title, description, ...productTerms.slice(0, 7), ...contacts.slice(0, 2), ...pages.slice(1, 4).map((p) => p.title)].filter(Boolean).length;
  const artifactMatches = (home.text.match(/bolt\.new|stackblitz|lovable|v0\.dev|built\s+with|powered\s+by|design instructions?/giu) || []).length;
  return { context: { source: "html", brandName, title: title || brandName, description, headings, navLabels, ctas, contacts, productTerms, images, colors, pages, signalCount: Math.max(1, signalCount) }, candidates: routes.length, artifacts: artifactMatches };
}

async function groqJson(apiKey: string, messages: GroqMessage[], maxTokens = 700) {
  const response = await fetch(GROQ_ENDPOINT, { method: "POST", cache: "no-store", signal: timeout(VISION_TIMEOUT), headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.GROQ_VISION_MODEL || MODEL, messages, response_format: { type: "json_object" }, reasoning_effort: "none", temperature: 0.1, max_completion_tokens: maxTokens }) });
  const data = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message || `Groq ${response.status}`);
  const raw = data?.choices?.[0]?.message?.content?.trim(); if (!raw) throw new Error("empty vision response");
  return JSON.parse(raw.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")) as Record<string, unknown>;
}
function contextPayload(context: SiteContext) {
  return { brandName: context.brandName, title: context.title, description: context.description, productTerms: context.productTerms.slice(0, 16), contacts: context.contacts, pages: context.pages.slice(0, 10).map((p) => ({ url: p.url, title: p.title, headings: p.headings.slice(0, 8), paragraphs: p.paragraphs.slice(0, 4), links: p.links.slice(0, 12).map((l) => ({ label: l.label, url: l.url })), imageAlts: p.images.map((i) => i.alt).filter(Boolean).slice(0, 6) })) };
}
function normalizeBusiness(raw: Record<string, unknown>, context: SiteContext): BusinessMap {
  const text = (v: unknown, fallback = "") => typeof v === "string" && !isArtifactText(v) ? clip(v, 200) : fallback;
  const cats: BusinessCategory[] = [];
  const sourceCats = Array.isArray(raw.categories) ? raw.categories : [];
  for (const item of sourceCats) {
    const obj = item && typeof item === "object" ? item as Record<string, unknown> : {}; const name = text(obj.name);
    if (!name || genericLabel(name) || cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    const observed = context.productTerms.some((t) => t.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(t.toLowerCase())) || context.pages.some((p) => p.headings.some((h) => h.toLowerCase().includes(name.toLowerCase())) || p.links.some((l) => l.label.toLowerCase().includes(name.toLowerCase())));
    if (!observed) continue;
    cats.push({ name, url: text(obj.url), summary: text(obj.summary), image: text(obj.image) }); if (cats.length >= 8) break;
  }
  for (const term of context.productTerms) { if (cats.length >= 6) break; if (!genericLabel(term) && !isArtifactText(term) && !cats.some((c) => c.name.toLowerCase() === term.toLowerCase())) cats.push({ name: term }); }
  return { brandName: text(raw.brandName, context.brandName) || context.brandName, industry: text(raw.industry), primaryOffer: text(raw.primaryOffer), audience: text(raw.audience), categories: cats.slice(0, 8), benefits: cleanStrings(Array.isArray(raw.benefits) ? raw.benefits.filter((v): v is string => typeof v === "string") : [], 6), contacts: cleanStrings([...(Array.isArray(raw.contacts) ? raw.contacts.filter((v): v is string => typeof v === "string") : []), ...context.contacts], 8), primaryCta: text(raw.primaryCta, context.ctas[0] || "Связаться"), evidence: cleanStrings(Array.isArray(raw.evidence) ? raw.evidence.filter((v): v is string => typeof v === "string") : [], 10) };
}
async function mapFromEvidence(apiKey: string, context: SiteContext, screenshots?: { mobile?: string; desktop?: string }) {
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: `Build an evidence-grounded business map from this website evidence: ${JSON.stringify(contextPayload(context))}. Return JSON {brandName,industry,primaryOffer,audience,categories:[{name,url,summary}],benefits:[],contacts:[],primaryCta,evidence:[]}. Category names must be directly observed on the site. Never treat builder/dev artifacts (Bolt, Vercel, StackBlitz, Lovable, v0, prompts, design instructions) as business content. Do not invent claims, prices, certifications or categories.` }];
  if (screenshots?.mobile) userContent.push({ type: "image_url", image_url: { url: screenshots.mobile } });
  if (screenshots?.desktop) userContent.push({ type: "image_url", image_url: { url: screenshots.desktop } });
  const raw = await groqJson(apiKey, [{ role: "system", content: "Commercial website analyst. Screenshot text can contain builder artifacts; ignore those. JSON only, evidence-grounded, no invented business facts." }, { role: "user", content: userContent }]);
  return normalizeBusiness(raw, context);
}
function contextStrong(context: SiteContext) { return context.pages.length >= 2 && context.signalCount >= 6 && context.productTerms.length >= 2; }
function businessStrong(map: BusinessMap) { return map.categories.length >= 2 && map.evidence.length >= 2 && !!map.primaryOffer && !isArtifactText(`${map.primaryOffer} ${map.industry}`); }
function evidenceStopContent(job: StoredJob, context: SiteContext, map: BusinessMap) {
  return [`## Site Intelligence v4 остановил редизайн ${new URL(job.targetUrl).hostname}`, "", "**Evidence Gate не пропустил генерацию.** Хасрой не будет придумывать структуру бизнеса, если сайт не дал достаточно подтверждённых данных.", "", `- Изучено страниц: **${context.pages.length}**`, `- Evidence signals: **${context.signalCount}**`, `- Подтверждённые направления: **${map.categories.map((c) => c.name).join(", ") || "не найдены"}**`, `- Контакт: **${map.contacts[0] || "не найден"}**`, "", "Нужен следующий источник данных: доступный каталог/sitemap, серверно-рендеримый контент или более информативные screenshots.", "", "_Site Intelligence v4 · evidence gate · no hallucinated redesign._"].join("\n");
}
function numbered(stage: string, progress: string) {
  const order: Record<string, string> = { SCREENSHOT_ORIGINAL: "03/16", VISION_AUDIT: "04/16", DESIGN_DEMO: "07/16", PREVIEW_WARM: "08/16", SCREENSHOT_DEMO: "09/16", COMPARE_MOBILE: "10/16", COMPARE_DESKTOP: "11/16", FINALIZE: "12/16", REPAIR_PLAN: "13/16", REPAIR_WARM: "13/16", REPAIR_SCREENSHOT: "14/16", REPAIR_COMPARE_MOBILE: "14/16", REPAIR_COMPARE_DESKTOP: "15/16", REPAIR_FINALIZE: "15/16", VERIFY_SKILLS: "16/16", DONE: "16/16" };
  return `${order[stage] || "•"} · ${progress}`;
}
function rewriteContent(content?: string) {
  if (!content) return content;
  return content.replace(/Site Intelligence v3/gu, "Site Intelligence v4").replace(/- обход внутренних страниц и извлечение бизнес-контекста/gu, "- глубокий crawl: sitemap + internal links + SPA route discovery + business evidence").replace(/no generic fallback sections/gu, "evidence gate + artifact filter");
}

export async function createSiteAgentJob(args: { ownerKey: string; origin: string; targetUrl: string; goal?: string }): Promise<SiteAgentJobResponse> {
  const result = await createV3Job(args);
  return { ...result, progress: "01/16 · Запускаю Site Intelligence v4: сначала собираю доказательства бизнеса, редизайн пока запрещён." };
}

export async function stepSiteAgentJob(args: { ownerKey: string; apiKey: string; jobId: string }): Promise<SiteAgentJobResponse> {
  let job = await loadJob(args.ownerKey, args.jobId);
  const intel: SiteIntel = job.siteIntel || {}; const v4 = intel.v4 || {};

  if (!v4.deepCrawled && job.stage !== "DONE") {
    const crawl = await deepCrawl(job.targetUrl); intel.context = crawl.context; intel.v4 = { ...v4, deepCrawled: true, routeCandidates: crawl.candidates, artifactFiltered: crawl.artifacts }; job.siteIntel = intel; await saveJob(args.ownerKey, job);
    return { jobId: job.id, stage: job.stage, done: false, progress: `02/16 · Deep Crawl: изучено ${crawl.context.pages.length} страниц, найдено ${crawl.candidates} маршрутов, business signals ${crawl.context.signalCount}; служебных артефактов отфильтровано ${crawl.artifacts}.`, retryAfterMs: 120 };
  }

  const context = intel.context!;
  if (!intel.businessMap && contextStrong(context)) {
    intel.businessMap = await mapFromEvidence(args.apiKey, context); intel.v4 = { ...v4, deepCrawled: true, evidenceGatePassed: businessStrong(intel.businessMap) }; job.siteIntel = intel; await saveJob(args.ownerKey, job);
    return { jobId: job.id, stage: job.stage, done: false, progress: `03/16 · Business Map из HTML: ${intel.businessMap.categories.map((c) => c.name).slice(0, 6).join(", ") || "категории пока не подтверждены"}.`, retryAfterMs: 120 };
  }

  if (!intel.businessMap && !contextStrong(context)) {
    if (job.stage === "SCREENSHOT_ORIGINAL" || job.stage === "VISION_AUDIT") {
      const base = await stepBaseJob(args); return { ...base, progress: numbered(base.stage, `HTML-контекста мало (${context.pages.length} стр., ${context.signalCount} signals). ${base.progress}`) };
    }
    if (job.stage === "DESIGN_DEMO") {
      intel.businessMap = await mapFromEvidence(args.apiKey, context, { mobile: job.originalMobile, desktop: job.originalDesktop }); intel.v4 = { ...v4, deepCrawled: true, visualFallbackUsed: true, evidenceGatePassed: businessStrong(intel.businessMap) }; job.siteIntel = intel;
      if (!businessStrong(intel.businessMap)) { job.success = false; job.content = evidenceStopContent(job, context, intel.businessMap); job.stage = "DONE"; await saveJob(args.ownerKey, job); return { jobId: job.id, stage: "DONE", done: true, progress: "06/16 · Evidence Gate: данных недостаточно. Редизайн остановлен без выдумывания контента.", content: job.content }; }
      await saveJob(args.ownerKey, job);
      return { jobId: job.id, stage: job.stage, done: false, progress: `06/16 · Vision Business Extraction подтвердил: ${intel.businessMap.categories.map((c) => c.name).slice(0, 6).join(", ")}. Evidence Gate открыт.`, retryAfterMs: 120 };
    }
  }

  if (intel.businessMap && !businessStrong(intel.businessMap) && job.stage === "DESIGN_DEMO") {
    intel.businessMap = await mapFromEvidence(args.apiKey, context, { mobile: job.originalMobile, desktop: job.originalDesktop }); intel.v4 = { ...v4, deepCrawled: true, visualFallbackUsed: true, evidenceGatePassed: businessStrong(intel.businessMap) }; job.siteIntel = intel;
    if (!businessStrong(intel.businessMap)) { job.success = false; job.content = evidenceStopContent(job, context, intel.businessMap); job.stage = "DONE"; await saveJob(args.ownerKey, job); return { jobId: job.id, stage: "DONE", done: true, progress: "06/16 · Evidence Gate не пропустил слабую Business Map. Никакого шаблонного редизайна.", content: job.content }; }
    await saveJob(args.ownerKey, job); return { jobId: job.id, stage: job.stage, done: false, progress: `06/16 · Скриншоты усилили Business Map: ${intel.businessMap.categories.map((c) => c.name).slice(0, 6).join(", ")}.`, retryAfterMs: 120 };
  }

  const result = await stepV3Job(args);
  return { ...result, progress: numbered(result.stage, result.progress), content: rewriteContent(result.content) };
}
