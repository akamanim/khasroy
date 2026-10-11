import { resolveSecret } from "@/lib/server-integrations";
import { getPendingTasks, getSkills } from "@/lib/server-memory";
import { dashboardStats, type DashboardStats } from "@/lib/invitations/server";

// Everything the owner console shows besides the chat. Each value is either measured or
// marked as unknown — the console never shows a status it did not check.

export type ProviderStatus = {
  id: "groq" | "cloudflare";
  name: string;
  state: "ok" | "limited" | "error" | "missing" | "unchecked";
  detail: string;
};

export type OwnerDashboard = {
  stats: DashboardStats | null;
  statsError?: string;
  model: string;
  providers: ProviderStatus[];
  skills: { verified: number; learning: number };
  tasks: Array<{ id: string; kind: string; status: string; updatedAt: string }>;
  attention: string[];
  checkedAt: string;
};

let providerCache: { at: number; value: ProviderStatus[] } | null = null;
const PROVIDER_TTL = 5 * 60_000;

async function probe(url: string, init: RequestInit): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(6000) });
    return { status: res.status, body: (await res.text().catch(() => "")).slice(0, 400) };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

async function checkProviders(ownerKey: string): Promise<ProviderStatus[]> {
  if (providerCache && Date.now() - providerCache.at < PROVIDER_TTL) return providerCache.value;
  const groqKey = await resolveSecret(ownerKey, "groq", [process.env.GROQ_API_KEY]).catch(() => "");
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfToken = process.env.CLOUDFLARE_AI_TOKEN?.trim() ?? "";

  const [groq, cf] = await Promise.all([
    groqKey
      ? probe("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${groqKey}` } })
      : Promise.resolve(null),
    cfAccount && cfToken
      ? probe("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${cfToken}` } })
      : Promise.resolve(null),
  ]);

  const value: ProviderStatus[] = [
    !groq
      ? { id: "groq", name: "Groq", state: "missing", detail: "нет ключа" }
      : groq.status === 200
        ? { id: "groq", name: "Groq", state: "ok", detail: "ключ работает" }
        : groq.status === 429
          ? { id: "groq", name: "Groq", state: "limited", detail: "упёрлись в лимит" }
          : { id: "groq", name: "Groq", state: "error", detail: `ошибка ${groq.status || "сети"}` },
    !cf
      ? { id: "cloudflare", name: "Cloudflare · Llama", state: "missing", detail: "не подключён" }
      : cf.status === 200
        ? { id: "cloudflare", name: "Cloudflare · Llama", state: "ok", detail: "токен работает" }
        : { id: "cloudflare", name: "Cloudflare · Llama", state: "error", detail: `ошибка ${cf.status || "сети"}` },
  ];
  providerCache = { at: Date.now(), value };
  return value;
}

export async function loadOwnerDashboard(ownerKey: string): Promise<OwnerDashboard> {
  const [statsResult, providersResult, skillsResult, tasksResult] = await Promise.allSettled([
    dashboardStats(),
    checkProviders(ownerKey),
    getSkills(ownerKey),
    getPendingTasks(ownerKey, 8),
  ]);
  const stats = statsResult.status === "fulfilled" ? statsResult.value : null;
  const providers = providersResult.status === "fulfilled" ? providersResult.value : [];
  const skills = skillsResult.status === "fulfilled" && Array.isArray(skillsResult.value) ? skillsResult.value : [];
  const tasks = tasksResult.status === "fulfilled" && Array.isArray(tasksResult.value) ? tasksResult.value : [];

  const attention: string[] = [];
  if (stats?.invitations.waiting) {
    attention.push(`${stats.invitations.waiting} ${stats.invitations.waiting === 1 ? "заказ ждёт" : "заказа ждут"} оплаты больше суток`);
  }
  for (const p of providers) {
    if (p.state === "error" || p.state === "limited") attention.push(`${p.name}: ${p.detail}`);
  }
  if (!stats) attention.push("Статистика приглашений не загрузилась");

  return {
    stats,
    ...(statsResult.status === "rejected" ? { statsError: String(statsResult.reason).slice(0, 200) } : {}),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    providers,
    skills: {
      verified: skills.filter((s) => s.status === "verified").length,
      learning: skills.filter((s) => s.status === "learning").length,
    },
    tasks: tasks.map((t) => ({ id: t.id, kind: t.kind, status: t.status, updatedAt: (t as { updated_at?: string }).updated_at ?? t.available_at })),
    attention,
    checkedAt: new Date().toISOString(),
  };
}
