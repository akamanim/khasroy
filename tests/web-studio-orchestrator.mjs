import assert from "node:assert/strict";
import { assertDraftOnlyAutonomy, planAutonomousWebStudio } from "../lib/web-studio-orchestrator.ts";

const plan = planAutonomousWebStudio({ brief: "Build a roofing company site", includeSmm: true, maxRepairAttempts: 99 });
assert.equal(plan.version, "web_studio_orchestrator_v1");
assert.equal(plan.target, "draft");
assert.equal(plan.productionUntouched, true);
assert.equal(plan.finalPromotionRequiresApproval, true);
assert.equal(plan.maxRepairAttempts, 3);
assert.equal(assertDraftOnlyAutonomy(plan), true);
assert.deepEqual(plan.steps.map((step) => step.stage), [
  "build_draft",
  "verify_draft",
  "repair_draft",
  "export_github",
  "prepare_smm",
  "ready_for_promotion",
]);
assert.equal(plan.steps.find((step) => step.stage === "prepare_smm")?.required, true);
assert.equal(plan.steps.find((step) => step.stage === "ready_for_promotion")?.approvalRequired, true);
assert.equal(plan.steps.some((step) => step.mutatesProduction), false);

const noSmm = planAutonomousWebStudio({ brief: "Site only", includeSmm: false, maxRepairAttempts: 0 });
assert.equal(noSmm.maxRepairAttempts, 1);
assert.equal(noSmm.steps.find((step) => step.stage === "prepare_smm")?.required, false);
assert.throws(() => planAutonomousWebStudio({ brief: "   " }), /brief_required/);

console.log("web studio orchestrator contract: ok");
