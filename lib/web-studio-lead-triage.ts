import type { SiteLead } from "@/lib/web-studio-editor";

export type LeadPriority = "hot" | "warm" | "normal" | "low";

export type TriagedLead = SiteLead & {
  score: number;
  priority: LeadPriority;
  nextAction: string;
  reasons: string[];
};

const URGENT_RE = /(срочн|сегодня|завтра|как можно скорее|быстро|цена|стоимост|заказать|купить|хочу|нужен|нужна|нужно|whatsapp|ватсап|звон)/iu;
const SPAM_RE = /(seo|casino|crypto|betting|backlink|guest post|traffic boost|viagra|loan)/iu;

function ageHours(createdAt: string, nowMs: number) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 9999;
  return Math.max(0, (nowMs - created) / 3_600_000);
}

export function triageLead(lead: SiteLead, now = new Date()): TriagedLead {
  let score = 0;
  const reasons: string[] = [];
  const text = `${lead.name} ${lead.phone} ${lead.message || ""}`;
  const hours = ageHours(lead.created_at, now.getTime());

  if (lead.status === "new") {
    score += 30;
    reasons.push("new_lead");
  } else if (lead.status === "qualified") {
    score += 42;
    reasons.push("qualified");
  } else if (lead.status === "contacted") {
    score += 18;
    reasons.push("already_contacted");
  } else if (lead.status === "won") {
    score -= 45;
    reasons.push("already_won");
  } else if (lead.status === "lost") {
    score -= 35;
    reasons.push("already_lost");
  } else if (lead.status === "spam") {
    score -= 100;
    reasons.push("marked_spam");
  }

  if (lead.phone.trim().length >= 7) {
    score += 18;
    reasons.push("contactable");
  }
  if ((lead.message || "").trim().length >= 30) {
    score += 12;
    reasons.push("detailed_request");
  }
  if (URGENT_RE.test(text)) {
    score += 22;
    reasons.push("purchase_or_urgency_signal");
  }
  if (hours <= 2) {
    score += 20;
    reasons.push("fresh_under_2h");
  } else if (hours <= 24) {
    score += 10;
    reasons.push("fresh_under_24h");
  } else if (hours >= 168) {
    score -= 10;
    reasons.push("older_than_7d");
  }
  if (SPAM_RE.test(text)) {
    score -= 80;
    reasons.push("spam_signal");
  }

  const bounded = Math.max(-100, Math.min(100, score));
  const priority: LeadPriority = bounded >= 70 ? "hot" : bounded >= 45 ? "warm" : bounded >= 15 ? "normal" : "low";
  const nextAction = lead.status === "spam"
    ? "ignore"
    : lead.status === "won"
      ? "retain_and_upsell"
      : lead.status === "lost"
        ? "review_lost_reason"
        : priority === "hot"
          ? "contact_now"
          : priority === "warm"
            ? "contact_today"
            : priority === "normal"
              ? "contact_next"
              : "review_manually";

  return { ...lead, score: bounded, priority, nextAction, reasons };
}

export function triageLeads(leads: SiteLead[], now = new Date()) {
  const triaged = leads.map((lead) => triageLead(lead, now)).sort((a, b) => b.score - a.score || Date.parse(b.created_at) - Date.parse(a.created_at));
  const summary = {
    total: triaged.length,
    hot: triaged.filter((lead) => lead.priority === "hot").length,
    warm: triaged.filter((lead) => lead.priority === "warm").length,
    normal: triaged.filter((lead) => lead.priority === "normal").length,
    low: triaged.filter((lead) => lead.priority === "low").length,
    new: triaged.filter((lead) => lead.status === "new").length,
    qualified: triaged.filter((lead) => lead.status === "qualified").length,
  };
  return { summary, leads: triaged };
}
