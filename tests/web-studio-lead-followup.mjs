import assert from "node:assert/strict";
import { planLeadFollowup, planLeadFollowups } from "../lib/web-studio-lead-followup.ts";

const base = {
  id: "lead-1",
  project_slug: "demo",
  name: "Client",
  phone: "+996555000000",
  message: "Хочу заказать сайт сегодня, позвоните пожалуйста",
  status: "new",
  created_at: "2026-09-15T00:00:00.000Z",
  updated_at: "2026-09-15T00:00:00.000Z",
  score: 90,
  priority: "hot",
  nextAction: "contact_now",
  reasons: [],
};

const hot = planLeadFollowup(base);
assert.equal(hot.eligible, true);
assert.equal(hot.action, "prepare_contact");
assert.equal(hot.targetStatus, "contacted");
assert.equal(hot.requiresHumanApproval, true);

const contacted = planLeadFollowup({ ...base, id: "lead-2", status: "contacted", priority: "warm" });
assert.equal(contacted.eligible, true);
assert.equal(contacted.action, "prepare_followup");
assert.equal(contacted.targetStatus, null);

for (const status of ["won", "lost", "spam"]) {
  const plan = planLeadFollowup({ ...base, id: `lead-${status}`, status });
  assert.equal(plan.eligible, false);
  assert.equal(plan.action, "hold");
}

const noPhone = planLeadFollowup({ ...base, id: "lead-no-phone", phone: "" });
assert.equal(noPhone.eligible, false);

const low = planLeadFollowup({ ...base, id: "lead-low", priority: "low", score: 0 });
assert.equal(low.eligible, false);

const batch = planLeadFollowups(Array.from({ length: 120 }, (_, index) => ({
  ...base,
  id: `lead-${index}`,
  priority: index < 100 ? "hot" : "low",
})), 500);
assert.equal(batch.plans.length, 100);
assert.equal(batch.eligible, 100);
assert.equal(batch.held, 0);
assert.equal(batch.autonomousMutationsAllowed, false);

console.log("web-studio lead follow-up planner: ok");
