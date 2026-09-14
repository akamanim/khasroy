import type { SmmContentItem } from "@/lib/smm-pipeline";

export type SmmArtifact = {
  planItemId: string;
  channel: SmmContentItem["channel"];
  format: SmmContentItem["format"];
  title: string;
  hook: string;
  script: string;
  caption: string;
  cta: string;
  shotList: string[];
  provenance: string;
};

export type SmmQualityIssue = {
  code: "missing_hook" | "missing_cta" | "caption_too_long" | "script_too_short" | "risky_claim";
  severity: "error" | "warning";
  message: string;
};

export type SmmComposeResult = {
  artifact: SmmArtifact;
  quality: {
    passed: boolean;
    repaired: boolean;
    attempts: number;
    issues: SmmQualityIssue[];
  };
};

const RISKY_CLAIM = /(100%|гарантированн(?:о|ый)|лучший\s+на\s+рынке|№\s*1|тысячи\s+клиентов|миллион(?:ы|ов)?\s+(?:сом|руб|доллар)|увелич(?:им|ение)\s+продаж\s+в\s+\d+)/iu;

function clean(value: string, max: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

function makeShotList(item: SmmContentItem) {
  if (item.format === "story") return ["Проблема одним кадром", "Опрос или вопрос", "Короткий ответ", "CTA"];
  if (item.format === "carousel") return ["Обложка с hook", "2–3 тезиса", "Практический пример", "Итог", "CTA"];
  if (item.format === "post") return ["Обложка", "Главный тезис", "Деталь или процесс", "CTA"];
  return ["Hook 0–2 сек", "Проблема", "Решение", "Результат без выдуманных цифр", "CTA"];
}

export function composeSmmArtifact(item: SmmContentItem): SmmArtifact {
  const hook = clean(item.hook, 300);
  const cta = clean(item.cta, 300);
  const angle = clean(item.angle, 1400);
  const channelLead = item.channel === "telegram"
    ? "Коротко и по делу:"
    : item.channel === "tiktok"
      ? "Покажи это динамично:"
      : "Сделай акцент на пользе:";

  const script = clean(`${hook}. ${channelLead} ${angle}. Заверши: ${cta}`, 5000);
  const caption = clean(`${hook}\n\n${angle}\n\n${cta}`, item.channel === "instagram" ? 2200 : 4000);

  return {
    planItemId: item.id,
    channel: item.channel,
    format: item.format,
    title: hook,
    hook,
    script,
    caption,
    cta,
    shotList: makeShotList(item),
    provenance: item.source,
  };
}

export function inspectSmmArtifact(artifact: SmmArtifact): SmmQualityIssue[] {
  const issues: SmmQualityIssue[] = [];
  if (!artifact.hook.trim()) issues.push({ code: "missing_hook", severity: "error", message: "Hook is required." });
  if (!artifact.cta.trim()) issues.push({ code: "missing_cta", severity: "error", message: "CTA is required." });
  if (artifact.caption.length > (artifact.channel === "instagram" ? 2200 : 4000)) {
    issues.push({ code: "caption_too_long", severity: "error", message: "Caption exceeds channel limit." });
  }
  if (artifact.script.length < 40) issues.push({ code: "script_too_short", severity: "warning", message: "Script is too short to be useful." });
  if (RISKY_CLAIM.test(`${artifact.title} ${artifact.script} ${artifact.caption}`)) {
    issues.push({ code: "risky_claim", severity: "error", message: "Draft contains an unsupported or risky marketing claim." });
  }
  return issues;
}

function repairRiskyClaims(value: string) {
  return value
    .replace(/100%/giu, "максимально")
    .replace(/гарантированн(?:о|ый)/giu, "ожидаемый")
    .replace(/лучший\s+на\s+рынке/giu, "сильный вариант")
    .replace(/№\s*1/giu, "один из вариантов")
    .replace(/тысячи\s+клиентов/giu, "клиенты")
    .replace(/миллион(?:ы|ов)?\s+(?:сом|руб|доллар)/giu, "измеримый результат")
    .replace(/увелич(?:им|ение)\s+продаж\s+в\s+\d+/giu, "рост продаж при подтверждённых данных");
}

export function repairSmmArtifact(artifact: SmmArtifact): SmmArtifact {
  const hook = clean(repairRiskyClaims(artifact.hook) || "Полезный разбор для клиента", 300);
  const cta = clean(repairRiskyClaims(artifact.cta) || "Напишите нам, чтобы обсудить задачу.", 300);
  let script = clean(repairRiskyClaims(artifact.script), 5000);
  if (script.length < 40) script = clean(`${hook}. Объясни проблему, покажи решение и заверши призывом: ${cta}`, 5000);
  const captionLimit = artifact.channel === "instagram" ? 2200 : 4000;
  const caption = clean(repairRiskyClaims(artifact.caption) || `${hook}\n\n${cta}`, captionLimit);
  return { ...artifact, title: clean(repairRiskyClaims(artifact.title) || hook, 300), hook, cta, script, caption };
}

export function composeWithRepairLoop(item: SmmContentItem, maxAttempts = 2): SmmComposeResult {
  let artifact = composeSmmArtifact(item);
  let issues = inspectSmmArtifact(artifact);
  let attempts = 0;
  let repaired = false;

  while (issues.some((issue) => issue.severity === "error") && attempts < Math.max(0, maxAttempts)) {
    artifact = repairSmmArtifact(artifact);
    attempts += 1;
    repaired = true;
    issues = inspectSmmArtifact(artifact);
  }

  return {
    artifact,
    quality: {
      passed: !issues.some((issue) => issue.severity === "error"),
      repaired,
      attempts,
      issues,
    },
  };
}
