import assert from "node:assert/strict";
import {
  advanceAutonomousWebStudioRun,
  assertDraftOnlyAutonomy,
  createAutonomousWebStudioRun,
  planAutonomousWebStudio,
} from "../lib/web-studio-orchestrator.ts";

const plan = planAutonomousWebStudio({ brief: "Build a roofing company site", includeSmm: true, maxRepairAttempts: 99 });
assert.equal(plan.version, "web_studio_orchestrator_v1");
assert.equal(plan.target, "draft");
assert.equal(plan.productionUntouched, true);
assert.equal(plan.finalPromotionRequiresApproval, true);
assert.equal(plan.maxRepairAttempts, 3);
assert.equal(assertDraftOnlyAutonomy(plan), true);
assert.deepEqual(plan.steps.map((step) => step.stage), [
  "build_draft", "verify_draft", "repair_draft", "export_github", "prepare_smm", "ready_for_promotion",
]);
assert.equal(plan.steps.find((step) => step.stage === "prepare_smm")?.required, true);
assert.equal(plan.steps.find((step) => step.stage === "ready_for_promotion")?.approvalRequired, true);
assert.equal(plan.steps.some((step) => step.mutatesProduction), false);

const noSmm = planAutonomousWebStudio({ brief: "Site only", includeSmm: false, maxRepairAttempts: 0 });
assert.equal(noSmm.maxRepairAttempts, 1);
assert.equal(noSmm.steps.find((step) => step.stage === "prepare_smm")?.required, false);
assert.throws(() => planAutonomousWebStudio({ brief: "   " }), /brief_required/);

let run = createAutonomousWebStudioRun(plan);
assert.equal(run.currentStage, "build_draft");
assert.equal(run.steps.find((step) => step.stage === "ready_for_promotion")?.state, "awaiting_approval");
run = advanceAutonomousWebStudioRun(run, { stage: "build_draft", ok: true });
assert.equal(run.currentStage, "verify_draft");
run = advanceAutonomousWebStudioRun(run, { stage: "verify_draft", ok: true, needsRepair: true });
assert.equal(run.currentStage, "repair_draft");
assert.equal(run.repairAttempts, 1);
run = advanceAutonomousWebStudioRun(run, { stage: "repair_draft", ok: true });
assert.equal(run.currentStage, "verify_draft");
run = advanceAutonomousWebStudioRun(run, { stage: "verify_draft", ok: true, needsRepair: false });
assert.equal(run.currentStage, "export_github");
run = advanceAutonomousWebStudioRun(run, { stage: "export_github", ok: true });
assert.equal(run.currentStage, "prepare_smm");
run = advanceAutonomousWebStudioRun(run, { stage: "prepare_smm", ok: true });
assert.equal(run.currentStage, null);
assert.equal(run.completed, true);
assert.equal(run.steps.find((step) => step.stage === "ready_for_promotion")?.state, "awaiting_approval");

let failed = createAutonomousWebStudioRun(plan);
failed = advanceAutonomousWebStudioRun(failed, { stage: "build_draft", ok: false, error: "provider unavailable" });
assert.equal(failed.blocked, true);
assert.equal(failed.completed, false);
assert.equal(failed.steps.find((step) => step.stage === "build_draft")?.state, "failed");
assert.throws(() => advanceAutonomousWebStudioRun(failed, { stage: "build_draft", ok: true }), /not_advanceable/);

let bounded = createAutonomousWebStudioRun(noSmm);
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "build_draft", ok: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "verify_draft", ok: true, needsRepair: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "repair_draft", ok: true });
bounded = advanceAutonomousWebStudioRun(bounded, { stage: "verify_draft", ok: true, needsRepair: true });
assert.equal(bounded.blocked, true);
assert.equal(bounded.repairAttempts, 1);

console.log("web studio orchestrator contract: ok");
