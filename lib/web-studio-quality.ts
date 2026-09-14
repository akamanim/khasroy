import type { WebStudioSpec } from "@/lib/web-studio";

export type DraftQualityReport = {
  ok: boolean;
  score: number;
  issues: string[];
  checks: Record<string, boolean>;
};

function meaningful(value: unknown, min = 3) {
  return typeof value === "string" && value.trim().length >= min;
}

export function auditDraftSpec(spec: WebStudioSpec): DraftQualityReport {
  const services = Array.isArray(spec.services) ? spec.services.filter((item) => meaningful(item)) : [];
  const advantages = Array.isArray(spec.advantages) ? spec.advantages.filter((item) => meaningful(item)) : [];
  const checks = {
    brand: meaningful(spec.brandName, 2),
    slug: meaningful(spec.slug, 2),
    headline: meaningful(spec.tagline, 8) && spec.tagline.length <= 140,
    description: meaningful(spec.description, 24) && spec.description.length <= 900,
    audience: meaningful(spec.audience, 8),
    primaryCta: meaningful(spec.primaryCta, 3) && spec.primaryCta.length <= 80,
    secondaryCta: meaningful(spec.secondaryCta, 3) && spec.secondaryCta.length <= 80,
    services: services.length >= 3 && services.length <= 9,
    advantages: advantages.length >= 3 && advantages.length <= 9,
    contact: meaningful(spec.contactText, 8),
    palette: Boolean(spec.palette?.background && spec.palette?.surface && spec.palette?.text && spec.palette?.muted && spec.palette?.accent),
    mobileCopy: spec.tagline.length <= 95 && spec.primaryCta.length <= 42 && services.every((item) => item.length <= 110),
    leadPath: spec.leadForm === true,
  };

  const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);
  return { ok: issues.length === 0, score, issues, checks };
}

export function qualityRepairInstruction(report: DraftQualityReport) {
  return `Исправь качество черновика по детерминированной проверке. Не меняй факты и бренд без необходимости. Обязательно устрани: ${report.issues.join(", ") || "unknown"}. Цель: короткий мобильный hero, ясные CTA, 3–9 услуг и преимуществ, рабочая форма заявки, полная палитра.`;
}
