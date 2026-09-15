import type { LeadFollowupPlan } from "@/lib/web-studio-lead-followup";

export type FollowupQueueItem = {
  operationKey: string;
  leadId: string;
  projectSlug: string;
  action: "prepare_contact" | "prepare_followup";
  channel: "phone";
  targetStatus: "contacted" | null;
  state: "awaiting_approval";
  attempts: 0;
};

/**
 * Convert deterministic follow-up plans into an execution-safe queue contract.
 * This remains provider-free and mutation-free: execution workers may persist or
 * claim these items later using operationKey as their idempotency key.
 */
export function buildFollowupQueue(plans: LeadFollowupPlan[], limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 25));
  const seen = new Set<string>();
  const items: FollowupQueueItem[] = [];

  for (const plan of plans) {
    if (items.length >= boundedLimit) break;
    if (!plan.eligible || !plan.operationKey || plan.channel !== "phone" || plan.action === "hold") continue;
    if (seen.has(plan.operationKey)) continue;
    seen.add(plan.operationKey);
    items.push({
      operationKey: plan.operationKey,
      leadId: plan.leadId,
      projectSlug: plan.projectSlug,
      action: plan.action,
      channel: "phone",
      targetStatus: plan.targetStatus,
      state: "awaiting_approval",
      attempts: 0,
    });
  }

  return {
    items,
    queued: items.length,
    requiresHumanApproval: true,
    autonomousExecutionAllowed: false,
    idempotencyField: "operationKey" as const,
  };
}
