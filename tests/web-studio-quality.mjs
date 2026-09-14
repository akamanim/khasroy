import assert from "node:assert/strict";
import { auditDraftSpec, qualityRepairInstruction } from "../lib/web-studio-quality.ts";

const good = {
  brandName: "Khasroy Studio",
  slug: "khasroy-studio",
  tagline: "Сайты, которые быстро ведут клиента к заявке",
  description: "Адаптивный сайт с понятной структурой, сильным оффером и формой заявки для быстрой проверки в черновом контуре.",
  audience: "Малый и средний бизнес",
  primaryCta: "Получить расчёт",
  secondaryCta: "Посмотреть услуги",
  services: ["Создание сайта", "Мобильная адаптация", "Форма заявки"],
  advantages: ["Быстрый запуск", "Черновая проверка", "Безопасная публикация"],
  contactText: "Оставьте заявку — мы свяжемся с вами.",
  palette: {
    background: "#0b0d10",
    surface: "#151922",
    text: "#f5f7fa",
    muted: "#9aa4b2",
    accent: "#5eead4",
  },
  leadForm: true,
};

const passed = auditDraftSpec(good);
assert.equal(passed.ok, true, JSON.stringify(passed));
assert.equal(passed.score, 100);
assert.deepEqual(passed.issues, []);

const bad = {
  ...good,
  tagline: "x".repeat(120),
  primaryCta: "x".repeat(50),
  services: ["Одна услуга"],
  advantages: [],
  contactText: "",
  palette: { background: "#000" },
  leadForm: false,
};

const failed = auditDraftSpec(bad);
assert.equal(failed.ok, false);
for (const issue of ["mobileCopy", "services", "advantages", "contact", "palette", "leadPath"]) {
  assert.equal(failed.issues.includes(issue), true, `missing issue: ${issue}`);
}
assert.equal(failed.score < 100, true);

const instruction = qualityRepairInstruction(failed);
for (const issue of failed.issues) {
  assert.equal(instruction.includes(issue), true, `repair instruction omitted ${issue}`);
}

console.log("WEB_STUDIO_QUALITY_GATE_OK", { passed: passed.score, failed: failed.score, issues: failed.issues });
