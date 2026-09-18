import type { SmmContentItem, SmmPlan } from "./smm-pipeline.ts";

export type SmmRepairIssue = {
  itemId: string;
  code: "empty_hook" | "empty_cta" | "duplicate_hook" | "unsupported_claim";
};

export type SmmRepairResult = {
  plan: SmmPlan;
  issues: SmmRepairIssue[];
  repaired: number;
};

const CLAIM_PATTERN = /(?:гарантирован|№\s*1|лучши[йея]|100%|миллион|тысяч[аи]?\s+(?:клиент|заказ)|официально\s+№)/iu;

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function safeHook(item: SmmContentItem, brandName: string) {
  const subject = item.angle.split(/[.:!?]/u)[0]?.trim().slice(0, 90) || "полезный разбор";
  return `${brandName}: ${subject}`.slice(0, 150);
}

function safeCta(plan: SmmPlan) {
  return `Напишите ${plan.brandName}, чтобы обсудить задачу.`.slice(0, 120);
}

function stripUnsupportedClaims(value: string) {
  return value
    .replace(/(?:гарантирован(?:но|ный|ная|ное)?|100%|официально\s+№\s*1|№\s*1)/giu, "")
    .replace(/\s{2,}/gu, " ")
    .replace(/\s+([,.!?])/gu, "$1")
    .trim();
}

export function auditAndRepairSmmPlan(input: SmmPlan): SmmRepairResult {
  const issues: SmmRepairIssue[] = [];
  const seenHooks = new Set<string>();
  let repaired = 0;

  const items = input.items.map((source) => {
    const item = { ...source };

    if (!normalized(item.hook)) {
      issues.push({ itemId: item.id, code: "empty_hook" });
      item.hook = safeHook(item, input.brandName);
      repaired += 1;
    }

    if (!normalized(item.cta)) {
      issues.push({ itemId: item.id, code: "empty_cta" });
      item.cta = safeCta(input);
      repaired += 1;
    }

    for (const field of ["hook", "angle", "cta"] as const) {
      if (!CLAIM_PATTERN.test(item[field])) continue;
      issues.push({ itemId: item.id, code: "unsupported_claim" });
      item[field] = stripUnsupportedClaims(item[field]);
      if (!item[field]) item[field] = field === "cta" ? safeCta(input) : safeHook(item, input.brandName);
      repaired += 1;
    }

    const hookKey = normalized(item.hook);
    if (seenHooks.has(hookKey)) {
      issues.push({ itemId: item.id, code: "duplicate_hook" });
      item.hook = `${item.hook} — день ${item.day}`.slice(0, 160);
      repaired += 1;
    }

    seenHooks.add(normalized(item.hook));
    return item;
  });

  return { plan: { ...input, items }, issues, repaired };
}
