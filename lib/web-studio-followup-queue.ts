import type { LeadFollowupPlan } from "@/lib/web-studio-lead-followup.ts";

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

export type FollowupQueuePersistResult = {
  attempted: number;
  inserted: number;
  deduplicated: number;
};

const SUPABASE_URL = process.env.KHASROY_SUPABASE_URL || "https://kebzlrmzbygxwfubnykq.supabase.co";
const SUPABASE_KEY = process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

/**
 * Convert deterministic follow-up plans into an execution-safe queue contract.
 * This remains provider-free: execution workers may persist or claim these items
 * later using operationKey as their idempotency key.
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

/** Persist only approval-pending queue rows. The database RPC verifies project ownership
 * and performs ON CONFLICT DO NOTHING, so retries are safe and idempotent. */
export async function persistFollowupQueue(ownerKey: string, items: FollowupQueueItem[]): Promise<FollowupQueuePersistResult> {
  const bounded = items.slice(0, 100);
  if (!bounded.length) return { attempted: 0, inserted: 0, deduplicated: 0 };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/enqueue_web_studio_followups`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ p_owner_key: ownerKey, p_items: bounded }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => null) as Array<{ operation_key?: string; inserted?: boolean }> | null;
  if (!response.ok || !Array.isArray(data)) throw new Error(`followup_queue_persist_${response.status}`);
  const inserted = data.filter((row) => row.inserted === true).length;
  return { attempted: bounded.length, inserted, deduplicated: bounded.length - inserted };
}
