import type { TriagedLead } from "@/lib/web-studio-lead-triage";

export type LeadFollowupPlan = {
  leadId: string;
  projectSlug: string;
  eligible: boolean;
  action: "prepare_contact" | "prepare_followup" | "hold";
  channel: "phone" | "none";
  targetStatus: "contacted" | null;
  requiresHumanApproval: true;
  reasons: string[];
};

export function planLeadFollowup(lead: TriagedLead): LeadFollowupPlan {
  const reasons: string[] = [];
  const phone = lead.phone.trim();
  const contactable = phone.length >= 7;
  const terminal = ["won", "lost", "spam"].includes(lead.status);

  if (terminal) reasons.push(`terminal_status:${lead.status}`);
  if (!contactable) reasons.push("missing_contact_channel");
  if (lead.priority === "low") reasons.push("low_priority");

  const eligible = !terminal && contactable && lead.priority !== "low";
  if (!eligible) {
    return {
      leadId: lead.id,
      projectSlug: lead.project_slug,
      eligible: false,
      action: "hold",
      channel: "none",
      targetStatus: null,
      requiresHumanApproval: true,
      reasons,
    };
  }

  const action = lead.status === "contacted" ? "prepare_followup" : "prepare_contact";
  reasons.push(lead.priority === "hot" ? "hot_priority" : lead.priority === "warm" ? "warm_priority" : "normal_priority");
  reasons.push("contactable");

  return {
    leadId: lead.id,
    projectSlug: lead.project_slug,
    eligible: true,
    action,
    channel: "phone",
    targetStatus: lead.status === "new" ? "contacted" : null,
    requiresHumanApproval: true,
    reasons,
  };
}

export function planLeadFollowups(leads: TriagedLead[], limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 25));
  const plans = leads.map(planLeadFollowup);
  return {
    plans: plans.slice(0, boundedLimit),
    eligible: plans.filter((plan) => plan.eligible).length,
    held: plans.filter((plan) => !plan.eligible).length,
    autonomousMutationsAllowed: false,
  };
}
