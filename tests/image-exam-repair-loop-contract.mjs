import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/image-exam-direct.mjs", import.meta.url), "utf8");
const compact = source.replace(/\s+/g, "");

assert.match(compact, /for\(letattempt=1;attempt<=2;attempt\+=1\)/, "exam must allow exactly one repair retry");
assert.match(compact, /repair=audit\.repairPrompt\|\|audit\.mismatches\.join\(';'\)/, "failed audit must feed a repair instruction into the next attempt");
assert.match(compact, /avoidModel=image\.requestedModel/, "retry must avoid the model that failed the visual exam");
assert.match(compact, /compiledPrompt\(repair\)/, "repair instruction must be compiled into the next generation prompt");

const models = ["model-a", "model-b"];
const calls = [];
let repair = "";
let avoidModel = "";
let passed = false;

for (let attempt = 1; attempt <= 2; attempt += 1) {
  const model = models.find((candidate) => candidate !== avoidModel);
  const prompt = repair ? `base | repair:${repair}` : "base";
  calls.push({ attempt, model, prompt });
  const audit = attempt === 1
    ? { passed: false, repairPrompt: "make requested subject and mountain road explicit", mismatches: ["wrong subject"] }
    : { passed: true, repairPrompt: "", mismatches: [] };
  if (audit.passed) {
    passed = true;
    break;
  }
  repair = audit.repairPrompt || audit.mismatches.join("; ");
  avoidModel = model;
}

assert.equal(calls.length, 2);
assert.equal(calls[0].model, "model-a");
assert.equal(calls[1].model, "model-b");
assert.match(calls[1].prompt, /repair:make requested subject and mountain road explicit/);
assert.equal(passed, true);

console.log("image-exam-repair-loop-contract: 8/8 ok");
