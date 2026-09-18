import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/social-studio/plan/route.ts", import.meta.url), "utf8");

assert.match(route, /import\s+\{\s*auditAndRepairSmmPlan\s*\}\s+from\s+["']@\/lib\/smm-repair["']/);
assert.match(route, /const\s+generatedPlan\s*=\s*buildSmmPlan\(/);
assert.match(route, /const\s+repair\s*=\s*auditAndRepairSmmPlan\(generatedPlan\)/);
assert.match(route, /const\s+plan\s*=\s*repair\.plan/);

const repairIndex = route.indexOf("auditAndRepairSmmPlan(generatedPlan)");
const persistableIndex = route.indexOf("const persistableItems = plan.items.filter");
const queueIndex = route.indexOf("queuePlanItem(ownerKey, apiKey, item)");
assert.ok(repairIndex >= 0, "repair call missing");
assert.ok(persistableIndex >= 0, "repaired plan persistence selection missing");
assert.ok(queueIndex >= 0, "Supabase social-store queue call missing");
assert.ok(repairIndex < persistableIndex, "SMM plan must be repaired before persistence selection");
assert.ok(persistableIndex < queueIndex, "repaired items must be selected before queue persistence");
assert.match(route, /action:\s*["']queue_social["']/);

assert.match(route, /repair:\s*\{[\s\S]*?repaired:\s*repair\.repaired,[\s\S]*?issues:\s*repair\.issues/);

console.log("smm plan route repair contract: ok");
