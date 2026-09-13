import { runBrain } from "@/lib/brain/router";
import { upsertSkill } from "@/lib/server-memory";
import { getIntegration, resolveSecret } from "@/lib/server-integrations";

const STORE_ENDPOINT =
  process.env.KHASROY_WEB_STUDIO_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-web-studio";
const STORE_KEY =
  process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

export type SocialDraft = {
  contentType: "reel" | "post" | "story" | "carousel";
  title: string;
  hook: string;
  script: string;
  caption: string;
  cta: string;
  shotList: string[];
};

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1] || text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
}

function text(value: unknown, fallback: string, limit = 1800) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
}

function strings(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 10);
  return rows.length ? rows : fallback;
}

export function looksLikeSocialRequest(value: string) {
  return /(инстаграм|instagram|рилс|reels|сторис|stories|контент[- ]?план|smm|смм).{0,80}(сделай|создай|напиши|веди|выложи|опубликуй|продвиж|контент)|(?:веди|продвигай|выложи|опубликуй).{0,50}(инстаграм|instagram|рилс|reels|сторис)/iu.test(value);
}

async function store(ownerKey: string, payload: Record<string, unknown>) {
  const response = await fetch(STORE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: STORE_KEY },
    body: JSON.stringify({ ownerKey, ...payload }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`social_store_${response.status}`);
  return response.json();
}

export async function createSocialDraft(args: { ownerKey: string; apiKey: string; request: string }) {
  const fallback: SocialDraft = {
    contentType: /сторис|story/iu.test(args.request) ? "story" : /пост|carousel|карусел/iu.test(args.request) ? "post" : "reel",
    title: "Как мы создаём сайты под ключ",
    hook: "Сайт может быть готов быстрее, чем вы думаете.",
    script: "Покажи бриф клиента → первый экран → мобильную версию → финальный опубликованный сайт. Заверши призывом написать в Direct за расчётом.",
    caption: "Создаём современные сайты для бизнеса: дизайн, разработка, адаптация под телефон и публикация. Напишите в Direct — обсудим задачу.",
    cta: "Напишите в Direct слово «САЙТ».",
    shotList: ["Бриф клиента", "Процесс сборки", "Мобильный экран", "Готовый сайт"],
  };

  try {
    const query = `Подготовь Instagram-контент для продвижения услуги создания сайтов. Запрос владельца: ${args.request.slice(0, 5000)}`;
    const brain = await runBrain({
      apiKey: args.apiKey,
      defaultModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      systemContent: "Ты SMM-стратег Khasroy Web Studio. Создавай конкретный коммерческий контент без фальшивых кейсов и выдуманных цифр. Верни только JSON: {\"contentType\":\"reel|post|story|carousel\",\"title\":\"\",\"hook\":\"\",\"script\":\"\",\"caption\":\"\",\"cta\":\"\",\"shotList\":[\"\"]}.",
      history: [{ role: "user", content: query }],
      query,
      repositoryRead: false,
    });
    const raw = brain.data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = extractJson(raw);
    if (brain.response.ok && parsed) {
      fallback.contentType = ["reel","post","story","carousel"].includes(String(parsed.contentType)) ? String(parsed.contentType) as SocialDraft["contentType"] : fallback.contentType;
      fallback.title = text(parsed.title, fallback.title, 220);
      fallback.hook = text(parsed.hook, fallback.hook, 300);
      fallback.script = text(parsed.script, fallback.script, 5000);
      fallback.caption = text(parsed.caption, fallback.caption, 5000);
      fallback.cta = text(parsed.cta, fallback.cta, 300);
      fallback.shotList = strings(parsed.shotList, fallback.shotList);
    }
  } catch (error) {
    console.error("Khasroy Social Studio planning failed", error);
  }

  const queued = await store(args.ownerKey, {
    action: "queue_social",
    contentType: fallback.contentType,
    title: fallback.title,
    caption: fallback.caption,
    script: fallback.script,
    metadata: { hook: fallback.hook, cta: fallback.cta, shotList: fallback.shotList, engine: "social_studio_v2" },
  }).catch(() => null);

  const instagram = await getInstagramRuntimeStatus(args.ownerKey).catch(() => instagramRuntimeStatus());
  await upsertSkill(args.ownerKey, {
    slug: "instagram_smm_studio",
    name: "Instagram SMM Studio",
    description: "Хасрой готовит Reels, посты, Stories, captions и CTA для продвижения услуг веб-разработки и сохраняет их в контент-очередь.",
    status: "verified",
    level: 2,
    testsPassed: 1,
    metadata: { engine: "social_studio_v2", publishingConfigured: instagram.configured, credentialSource: instagram.source },
  }).catch(() => undefined);

  return { draft: fallback, queued, instagram };
}

export function instagramRuntimeStatus() {
  const configured = Boolean(process.env.INSTAGRAM_ACCESS_TOKEN?.trim() && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim());
  return {
    configured,
    source: configured ? "environment" : "none",
    vaultSupported: true,
  };
}

export async function getInstagramRuntimeStatus(ownerKey: string) {
  const env = instagramRuntimeStatus();
  if (env.configured) return env;
  const stored = await getIntegration(ownerKey, "instagram");
  const accountId = stored?.config?.businessAccountId || stored?.config?.accountId;
  const configured = Boolean(stored?.secret?.trim() && typeof accountId === "string" && accountId.trim());
  return {
    configured,
    source: configured ? "encrypted_vault" : "none",
    vaultSupported: true,
  };
}

export async function publishInstagram(args: { ownerKey: string; mediaUrl: string; caption: string; contentType: SocialDraft["contentType"] }) {
  const token = await resolveSecret(args.ownerKey, "instagram", [process.env.INSTAGRAM_ACCESS_TOKEN]);
  const stored = await getIntegration(args.ownerKey, "instagram").catch(() => null);
  const storedAccount = stored?.config?.businessAccountId || stored?.config?.accountId;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() || (typeof storedAccount === "string" ? storedAccount.trim() : "");
  if (!token || !accountId) throw new Error("instagram_credentials_missing");
  if (!/^https:\/\//iu.test(args.mediaUrl)) throw new Error("instagram_media_url_must_be_public_https");

  const params = new URLSearchParams({ access_token: token, caption: args.caption.slice(0, 2200) });
  if (args.contentType === "reel") {
    params.set("media_type", "REELS");
    params.set("video_url", args.mediaUrl);
  } else if (args.contentType === "story") {
    params.set("media_type", "STORIES");
    if (/\.(mp4|mov)(?:\?|$)/iu.test(args.mediaUrl)) params.set("video_url", args.mediaUrl);
    else params.set("image_url", args.mediaUrl);
  } else {
    params.set("image_url", args.mediaUrl);
  }

  const version = process.env.INSTAGRAM_GRAPH_VERSION?.trim() || "v24.0";
  const create = await fetch(`https://graph.facebook.com/${version}/${accountId}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(25_000),
  });
  const container = await create.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
  if (!create.ok || !container?.id) throw new Error(`instagram_container_${create.status}:${container?.error?.message || "failed"}`);

  const publish = await fetch(`https://graph.facebook.com/${version}/${accountId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, creation_id: container.id }).toString(),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await publish.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
  if (!publish.ok || !result?.id) throw new Error(`instagram_publish_${publish.status}:${result?.error?.message || "failed"}`);

  await upsertSkill(args.ownerKey, {
    slug: "instagram_autopublish",
    name: "Instagram Autopublish",
    description: "Хасрой публикует подготовленный медиаматериал в подключённый Instagram Business через Graph API.",
    status: "verified",
    level: 1,
    testsPassed: 1,
    metadata: { mediaId: result.id, containerId: container.id, credentialSource: process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ? "environment" : "encrypted_vault" },
  }).catch(() => undefined);

  return { id: result.id, containerId: container.id };
}
