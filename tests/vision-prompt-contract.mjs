import assert from "node:assert/strict";
import { evaluateImagePromptContract, parseStructuredImagePrompt } from "../lib/vision-prompt-contract.mjs";

const good = [
  "Subject: Красный Changan Q05 на горной дороге",
  "Scene: высокие заснеженные горы, ясное небо",
  "Composition: автомобиль в нижней трети кадра",
  "Lighting: естественный дневной свет",
  "Camera: eye-level, 50mm feel",
  "Style: реалистичная фотография",
  "Constraints: без текста и водяных знаков",
].join("\n");

const parsed = parseStructuredImagePrompt(good);
assert.equal(parsed.Subject, "Красный Changan Q05 на горной дороге");
assert.equal(parsed.Scene, "высокие заснеженные горы, ясное небо");

const pass = evaluateImagePromptContract({
  originalRequest: "Красный Changan Q05 на горной дороге, высокие заснеженные горы, ясное небо",
  compiledPrompt: good,
  required: {
    Subject: "Красный Changan Q05 на горной дороге",
    Scene: "высокие заснеженные горы, ясное небо",
    Constraints: "без текста и водяных знаков",
  },
});
assert.equal(pass.ok, true);
assert.equal(pass.failures.length, 0);
assert.ok(pass.semanticCoverage >= 0.8);

const missingSubject = evaluateImagePromptContract({
  originalRequest: "BMW M5 CS на заснеженной горной дороге",
  compiledPrompt: "Scene: заснеженная горная дорога\nStyle: реалистичная фотография",
});
assert.equal(missingSubject.ok, false);
assert.ok(missingSubject.failures.includes("subject_missing"));

const drift = evaluateImagePromptContract({
  originalRequest: "Кенгуру за рулём BMW, держит руль двумя лапами",
  compiledPrompt: "Subject: человек за рулём седана\nScene: городская улица",
});
assert.equal(drift.ok, false);
assert.ok(drift.failures.includes("original_request_drift"));

const missingRequired = evaluateImagePromptContract({
  originalRequest: "Стальной термос на известняке",
  compiledPrompt: "Subject: Стальной термос на известняке\nStyle: реалистичная фотография",
  required: { Lighting: "мягкий свет слева" },
});
assert.equal(missingRequired.ok, false);
assert.ok(missingRequired.failures.includes("lighting_missing"));

const constraintDrift = evaluateImagePromptContract({
  originalRequest: "Термос, без логотипа и текста",
  compiledPrompt: "Subject: Термос, без логотипа и текста\nConstraints: добавить логотип бренда",
  required: { Constraints: "без логотипа и текста" },
});
assert.equal(constraintDrift.ok, false);
assert.ok(constraintDrift.failures.includes("constraints_drift"));

console.log(JSON.stringify({
  ok: true,
  tests: 6,
  goodScore: pass.score,
  goodCoverage: pass.semanticCoverage,
  guardedFailures: [
    "subject_missing",
    "original_request_drift",
    "lighting_missing",
    "constraints_drift",
  ],
}));
