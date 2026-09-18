import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/social-studio/plan/route.ts", import.meta.url), "utf8");

assert.match(route, /import\s+\{\s*auditAndRepairSmmPlan\s*\}\s+from\s+["']@\/lib\/smm-repair["']/);
assert.match(route, /const\s+generatedPlan\s*=\s*buildSmmPlan\(/);
assert.match(route, /const\s+repair\s*=\s*auditAndRepairSmmPlan\(generatedPlan\)/);
assert.match(route, /const\s+plan\s*=\s*repair\.plan/);

const repairIndex = route.indexOf("auditAndRepairSmmPlan(generatedPlan)");
const persistenceIndex = route.indexOf("khasroy_social_queue");
assert.ok(repairIndex >= 0, "repair call missing");
assert.ok(persistenceIndex >= 0, "Supabase social queue persistence missing");
assert.ok(repairIndex < persistenceIndex, "SMM plan must be repaired before Supabase persistence");

assert.match(route, /repair:\s*\{[\s\S]*?repaired:\s*repair\.repaired,[\s\S]*?issues:\s*repair\.issues/);

console.log("smm plan route repair contract: ok");
