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

export type WebStudioRunStepState = "pending" | "running" | "succeeded" | "failed" | "skipped" | "awaiting_approval";

export type WebStudioAutonomousRun = {
  version: "web_studio_run_v1";
  plan: WebStudioAutonomousPlan;
  currentStage: WebStudioAutonomousStage | null;
  repairAttempts: number;
  completed: boolean;
  blocked: boolean;
  steps: Array<WebStudioAutonomousStep & { state: WebStudioRunStepState; error?: string }>;
};

export type WebStudioRunSnapshot = {
  version: "web_studio_snapshot_v1";
  savedAt: string;
  run: WebStudioAutonomousRun;
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

export function createAutonomousWebStudioRun(plan: WebStudioAutonomousPlan): WebStudioAutonomousRun {
  assertDraftOnlyAutonomy(plan);
  const steps = plan.steps.map((step) => ({
    ...step,
    state: (!step.required ? "skipped" : step.approvalRequired ? "awaiting_approval" : "pending") as WebStudioRunStepState,
  }));
  const first = steps.find((step) => step.state === "pending");
  if (first) first.state = "running";
  return { version: "web_studio_run_v1", plan, currentStage: first?.stage ?? null, repairAttempts: 0, completed: false, blocked: false, steps };
}

export function snapshotAutonomousWebStudioRun(run: WebStudioAutonomousRun, savedAt = new Date().toISOString()): WebStudioRunSnapshot {
  assertDraftOnlyAutonomy(run.plan);
  return { version: "web_studio_snapshot_v1", savedAt, run: { ...run, steps: run.steps.map((step) => ({ ...step })) } };
}

export function resumeAutonomousWebStudioRun(snapshot: WebStudioRunSnapshot): WebStudioAutonomousRun {
  if (snapshot.version !== "web_studio_snapshot_v1") throw new Error("orchestrator_snapshot_version_invalid");
  const run = snapshot.run;
  assertDraftOnlyAutonomy(run.plan);
  if (run.version !== "web_studio_run_v1") throw new Error("orchestrator_run_version_invalid");
  if (run.repairAttempts < 0 || run.repairAttempts > run.plan.maxRepairAttempts) throw new Error("orchestrator_repair_attempts_invalid");
  const running = run.steps.filter((step) => step.state === "running");
  if (run.blocked || run.completed) {
    if (run.currentStage !== null || running.length !== 0) throw new Error("orchestrator_terminal_state_invalid");
  } else if (run.currentStage !== null) {
    if (running.length !== 1 || running[0].stage !== run.currentStage) throw new Error("orchestrator_running_state_invalid");
  }
  return { ...run, steps: run.steps.map((step) => ({ ...step })) };
}

export function retryBlockedAutonomousWebStudioRun(run: WebStudioAutonomousRun): WebStudioAutonomousRun {
  assertDraftOnlyAutonomy(run.plan);
  if (!run.blocked || run.completed || run.currentStage !== null) throw new Error("orchestrator_run_not_retryable");
  if (run.steps.some((step) => step.state === "running")) throw new Error("orchestrator_retry_running_state_invalid");
  const failed = run.steps.filter((step) => step.state === "failed");
  if (failed.length !== 1) throw new Error("orchestrator_retry_failed_stage_invalid");
  const failedStep = failed[0];
  if (failedStep.stage === "ready_for_promotion" || failedStep.approvalRequired || failedStep.mutatesProduction) {
    throw new Error("orchestrator_retry_stage_forbidden");
  }
  const next: WebStudioAutonomousRun = { ...run, blocked: false, currentStage: failedStep.stage, steps: run.steps.map((step) => ({ ...step })) };
  const retry = next.steps.find((step) => step.stage === failedStep.stage);
  if (!retry) throw new Error("orchestrator_retry_stage_missing");
  retry.state = "running";
  delete retry.error;
  return next;
}

export function advanceAutonomousWebStudioRun(
  run: WebStudioAutonomousRun,
  result: { stage: WebStudioAutonomousStage; ok: boolean; error?: string; needsRepair?: boolean },
): WebStudioAutonomousRun {
  if (run.completed || run.blocked) throw new Error("orchestrator_run_not_advanceable");
  if (run.currentStage !== result.stage) throw new Error("orchestrator_stage_mismatch");
  const next: WebStudioAutonomousRun = { ...run, steps: run.steps.map((step) => ({ ...step })) };
  const current = next.steps.find((step) => step.stage === result.stage);
  if (!current || current.state !== "running") throw new Error("orchestrator_stage_not_running");
  if (!result.ok) {
    current.state = "failed";
    current.error = (result.error || "stage_failed").slice(0, 500);
    next.currentStage = null;
    next.blocked = true;
    return next;
  }
  current.state = "succeeded";
  delete current.error;
  if (result.stage === "verify_draft" && result.needsRepair) {
    const repair = next.steps.find((step) => step.stage === "repair_draft");
    if (!repair || next.repairAttempts >= next.plan.maxRepairAttempts) {
      next.currentStage = null;
      next.blocked = true;
      return next;
    }
    next.repairAttempts += 1;
    repair.state = "running";
    next.currentStage = "repair_draft";
    return next;
  }
  if (result.stage === "repair_draft") {
    const verify = next.steps.find((step) => step.stage === "verify_draft");
    if (!verify) throw new Error("verify_stage_missing");
    verify.state = "running";
    next.currentStage = "verify_draft";
    return next;
  }
  const currentIndex = next.steps.findIndex((step) => step.stage === result.stage);
  const following = next.steps.slice(currentIndex + 1).find((step) => step.state !== "skipped" && step.state !== "succeeded");
  if (!following || following.state === "awaiting_approval") {
    next.currentStage = null;
    next.completed = Boolean(following?.stage === "ready_for_promotion");
    return next;
  }
  following.state = "running";
  next.currentStage = following.stage;
  return next;
}
