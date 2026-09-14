import assert from "node:assert/strict";
import { composeWithRepairLoop, inspectSmmArtifact, repairSmmArtifact } from "../lib/smm-compose.ts";

const base = {
  id: "d1-instagram-reel-offer",
  day: 1,
  channel: "instagram",
  format: "reel",
  pillar: "offer",
  hook: "Почему бизнесу нужен понятный сайт?",
  angle: "Показать проблему, решение и ожидаемый результат без неподтверждённых обещаний.",
  cta: "Оставить заявку",
  source: "web-studio:services[0]",
};

const composed = composeWithRepairLoop(base);
assert.equal(composed.quality.passed, true);
assert.equal(composed.artifact.planItemId, base.id);
assert.equal(composed.artifact.channel, "instagram");
assert.ok(composed.artifact.script.length > 40);
assert.ok(composed.artifact.caption.includes(base.cta));
assert.ok(composed.artifact.shotList.length >= 4);

const risky = {
  ...composed.artifact,
  hook: "Мы гарантированно №1 и дадим 100% результат",
  title: "Лучший на рынке",
  caption: "Тысячи клиентов и 100% результат",
  script: "Увеличим продаж в 10 раз гарантированно",
};
assert.ok(inspectSmmArtifact(risky).some((issue) => issue.code === "risky_claim"));
const repaired = repairSmmArtifact(risky);
assert.equal(inspectSmmArtifact(repaired).some((issue) => issue.severity === "error"), false);

const autoRepaired = composeWithRepairLoop({ ...base, hook: "Гарантированно №1 — 100% результат" }, 2);
assert.equal(autoRepaired.quality.passed, true);
assert.equal(autoRepaired.quality.repaired, true);
assert.ok(autoRepaired.quality.attempts >= 1);

console.log("SMM compose repair loop OK");
