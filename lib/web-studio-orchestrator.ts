export type WebStudioAutonomousStage =
  | "build_draft"
  | "verify_draft"
  | "repair_draft"
  | "export_github"
  | "prepare_smm"
  | "ready_for_promotion";

export type WebStudioAutonomousInput = {
  brief: string;
  projectSlug?: string;
  includeSmm?: boolean;
  maxRepairAttempts?: number;
};

export type WebStudioAutonomousStep = {
  stage: WebStudioAutonomousStage;
  required: boolean;
  mutatesProduction: boolean;
  approvalRequired: boolean;
};

export type WebStudioAutonomousPlan = {
  version: "web_studio_orchestrator_v1";
  target: "draft";
  productionUntouched: true;
  finalPromotionRequiresApproval: true;
  maxRepairAttempts: number;
  steps: WebStudioAutonomousStep[];
};

function boundedRepairAttempts(value: number | undefined) {
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(3, Math.trunc(value as number)));
}

export function planAutonomousWebStudio(input: WebStudioAutonomousInput): WebStudioAutonomousPlan {
  if (!input.brief.trim()) throw new Error("brief_required");
  const includeSmm = input.includeSmm !== false;
  return {
    version: "web_studio_orchestrator_v1",
    target: "draft",
    productionUntouched: true,
    finalPromotionRequiresApproval: true,
    maxRepairAttempts: boundedRepairAttempts(input.maxRepairAttempts),
    steps: [
      { stage: "build_draft", required: true, mutatesProduction: false, approvalRequired: false },
      { stage: "verify_draft", required: true, mutatesProduction: false, approvalRequired: false },
      { stage: "repair_draft", required: true, mutatesProduction: false, approvalRequired: false },
      { stage: "export_github", required: true, mutatesProduction: false, approvalRequired: false },
      { stage: "prepare_smm", required: includeSmm, mutatesProduction: false, approvalRequired: false },
      { stage: "ready_for_promotion", required: true, mutatesProduction: false, approvalRequired: true },
    ],
  };
}

export function assertDraftOnlyAutonomy(plan: WebStudioAutonomousPlan) {
  if (plan.target !== "draft" || plan.productionUntouched !== true) throw new Error("autonomy_must_be_draft_only");
  if (!plan.finalPromotionRequiresApproval) throw new Error("production_approval_required");
  if (plan.steps.some((step) => step.mutatesProduction)) throw new Error("autonomous_step_mutates_production");
  const promotion = plan.steps.find((step) => step.stage === "ready_for_promotion");
  if (!promotion?.approvalRequired) throw new Error("promotion_boundary_missing");
  return true;
}
