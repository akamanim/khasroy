import assert from "node:assert/strict";
import { buildSmmPlan } from "../lib/smm-pipeline.ts";

const spec = {
  projectName: "Prombaza",
  slug: "prombaza",
  brandName: "Prombaza",
  tagline: "Кровля и фасад для вашего дома",
  description: "Металлочерепица, профнастил и сайдинг.",
  audience: "владельцы домов и строители",
  primaryCta: "Получить расчёт",
  secondaryCta: "Смотреть каталог",
  contactText: "Оставьте заявку на расчёт.",
  services: ["Металлочерепица", "Профнастил", "Сайдинг"],
  advantages: ["Точный расчёт", "Быстрая комплектация", "Помощь с подбором"],
  palette: { background: "#071019", surface: "#101c27", text: "#f7fbff", muted: "#9fb1bf", accent: "#6ee7d8" },
  style: "industrial premium",
  leadForm: true,
};

const plan = buildSmmPlan(spec, 7);
assert.equal(plan.brandName, "Prombaza");
assert.equal(plan.objective, "lead_generation");
assert.equal(plan.items.length, 7);
assert.deepEqual(plan.items.map((item) => item.day), [1, 2, 3, 4, 5, 6, 7]);
assert.ok(plan.items.some((item) => item.channel === "instagram" && item.format === "reel"));
assert.ok(plan.items.some((item) => item.channel === "telegram"));
assert.ok(plan.items.every((item) => item.cta.length > 0 && item.source.startsWith("web-studio:")));
assert.ok(plan.items.find((item) => item.pillar === "proof")?.angle.includes("Не выдумывать"));

const bounded = buildSmmPlan(spec, 99);
assert.equal(bounded.cadenceDays, 14);
assert.equal(bounded.items.length, 14);
assert.equal(new Set(bounded.items.map((item) => item.id)).size, 14);

console.log("SMM pipeline planner: ok");
