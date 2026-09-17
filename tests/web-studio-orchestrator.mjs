import assert from "node:assert/strict";
import {
  advanceAutonomousWebStudioRun,
  assertDraftOnlyAutonomy,
  createAutonomousWebStudioRun,
  planAutonomousWebStudio,
  resumeAutonomousWebStudioRun,
  retryBlockedAutonomousWebStudioRun,
  snapshotAutonomousWebStudioRun,
} from "../lib/web-studio-orchestrator.ts";

const plan = planAutonomousWebStudio({ brief: "Build a roofing company site", includeSmm: true, maxRepairAttempts: 99 });
assert.equal(plan.version, "web_studio_orchestrator_v1");
assert.equal(plan.target, "draft");
assert.equal(plan.productionUntouched, true);
assert.equal(plan.finalPromotionRequiresApproval, true);
assert.equal(plan.maxRepairAttempts, 3);
assert.equal(assertDraftOnlyAutonomy(plan), true);
assert.deepEqual(plan.steps.map((step) => step.stage), ["build_draft", "verify_draft", "repair_draft", "export_github", "prepare_smm", "ready_for_promotion"]);
assert.equal(plan.steps.find((step) => step.stage === "prepare_smm")?.required, true);
assert.equal(plan.steps.find((step) => step.stage === "ready_for_promotion")?.approvalRequired, true);
assert.equal(plan.steps.some((step) => step.mutatesProduction), false);

const noSmm = planAutonomousWebStudio({ brief: "Site only", includeSmm: false, maxRepairAttempts: 0 });
assert.equal(noSmm.maxRepairAttempts, 1);
assert.equal(noSmm.steps.find((step) => step.stage === "prepare_smm")?.required, false);
assert.throws(() => planAutonomousWebStudio({ brief: "   " }), /brief_required/);

let run = createAutonomousWebStudioRun(plan);
assert.equal(run.currentStage, "build_draft");
run = advanceAutonomousWebStudioRun(run, { stage: "build_draft", ok: true });
const snapshot = snapshotAutonomousWebStudioRun(run, "2026-09-17T07:00:00.000Z");
assert.equal(snapshot.version, "web_studio_snapshot_v1");
assert.equal(snapshot.savedAt, "2026-09-17T07:00:00.000Z");
run = resumeAutonomousWebStudioRun(snapshot);
assert.equal(run.currentStage, "verify_draft");
run = advanceAutonomousWebStudioRun(run, { stage: "verify_draft", ok: true, needsRepair: true });
assert.equal(run.currentStage, "repair_draft");
assert.equal(run.repairAttempts, 1);
run = advanceAutonomousWebStudioRun(run, { stage: "repair_draft", ok: true });
run = advanceAutonomousWebStudioRun(run, { stage: "verify_draft", ok: true, needsRepair: false });
run = advanceAutonomousWebStudioRun(run, { stage: "export_github", ok: true });
run = advanceAutonomousWebStudioRun(run, { stage: "prepare_smm", ok: true });
assert.equal(run.currentStage, null);
assert.equal(run.completed, true);
assert.equal(run.steps.find((step) => step.stage === "ready_for_promotion")?.state, "awaiting_approval");

const corrupt = snapshotAutonomousWebStudioRun(createAutonomousWebStudioRun(plan));
corrupt.run.currentStage = "verify_draft";
assert.throws(() => resumeAutonomousWebStudioRun(corrupt), /running_state_invalid/);

let failed = createAutonomousWebStudioRun(plan);
failed = advanceAutonomousWebStudioRun(failed, { stage: "build_draft", ok: false, error: "provider unavailable" });
assert.equal(failed.blocked, true);
assert.throws(() => advanceAutonomousWebStudioRun(failed, { stage: "build_draft", ok: true }), /not_advanceable/);
failed = retryBlockedAutonomousWebStudioRun(failed);
assert.equal(failed.blocked, false);
assert.equal(failed.currentStage, "build_draft");
assert.equal(failed.steps.find((step) => step.stage === "build_draft")?.state, "running");
failed = advanceAutonomousWebStudioRun(failed, { stage: "build_draft", ok: true });
assert.equal(failed.currentStage, "verify_draft");
assert.throws(() => retryBlockedAutonomousWebStudioRun(failed), /not_retryable/);

let bounded = createAutonomousWebStudioRun(noSmm);
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "build_draft", ok: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "verify_draft", ok: true, needsRepair: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "repair_draft", ok: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "verify_draft", ok: true, needsRepair: true });
assert.equal(bounded.blocked, true);
assert.equal(bounded.repairAttempts, 1);
assert.throws(() => retryBlockedAutonomousWebStudioRun(bounded), /failed_stage_invalid/);

console.log("web studio orchestrator contract: ok");
