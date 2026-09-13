import assert from "node:assert/strict";
import { assertImagePromptPreflight, evaluateImagePromptPreflight } from "../lib/image-prompt-preflight.mjs";

let generatorCalls = 0;
async function guardedGenerate(originalRequest, compiledPrompt) {
  const preflight = assertImagePromptPreflight({ originalRequest, compiledPrompt });
  generatorCalls += 1;
  return { image: "fake-image", preflight };
}

const original = "Красный Changan Q05 на горной дороге, высокие заснеженные горы, без текста и водяных знаков";
const compiled = `Create exactly this image: ${original}. Main requested subject and requested background must both be clearly visible.`;
const pass = await guardedGenerate(original, compiled);
assert.equal(pass.preflight.ok, true);
assert.equal(pass.preflight.coverage, 1);
assert.equal(generatorCalls, 1);

const drift = evaluateImagePromptPreflight({
  originalRequest: "Кенгуру за рулём BMW M5 CS на горной дороге",
  compiledPrompt: "Create a person driving a generic sedan through a city street",
});
assert.equal(drift.ok, false);
assert.ok(drift.failures.includes("original_request_drift"));

await assert.rejects(
  () => guardedGenerate("BMW M5 CS на снегу", "человек в спальне"),
  /image_prompt_preflight_failed:original_request_drift/,
);
assert.equal(generatorCalls, 1, "rejected prompt must not spend a generator call");

const empty = evaluateImagePromptPreflight({ originalRequest: "Термос на камне", compiledPrompt: "" });
assert.equal(empty.ok, false);
assert.ok(empty.failures.includes("compiled_prompt_missing"));

console.log(JSON.stringify({
  ok: true,
  tests: 4,
  validCoverage: pass.preflight.coverage,
  rejectedBeforeGenerator: true,
  generatorCalls,
  guardedFailures: ["original_request_drift", "compiled_prompt_missing"],
}));
