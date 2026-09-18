import assert from "node:assert/strict";
import { auditAndRepairSmmPlan } from "../lib/smm-repair.ts";

const plan = {
  brandName: "Khasroy Studio",
  audience: "business owners",
  objective: "lead_generation",
  cadenceDays: 3,
  items: [
    { id: "a", day: 1, channel: "instagram", format: "reel", pillar: "offer", hook: "", angle: "Website redesign for leads.", cta: "", source: "test" },
    { id: "b", day: 2, channel: "instagram", format: "post", pillar: "trust", hook: "100% лучший результат", angle: "Гарантированно увеличим продажи", cta: "Напишите нам", source: "test" },
    { id: "c", day: 3, channel: "telegram", format: "post", pillar: "education", hook: "100% лучший результат", angle: "Практический разбор", cta: "Напишите нам", source: "test" },
  ],
};

const result = auditAndRepairSmmPlan(plan);
assert.ok(result.repaired >= 4);
assert.ok(result.issues.some((issue) => issue.code === "empty_hook"));
assert.ok(result.issues.some((issue) => issue.code === "empty_cta"));
assert.ok(result.issues.some((issue) => issue.code === "unsupported_claim"));
assert.equal(result.plan.items.every((item) => item.hook.trim() && item.cta.trim()), true);
assert.equal(result.plan.items.some((item) => /100%|гарантирован/iu.test(`${item.hook} ${item.angle} ${item.cta}`)), false);
assert.equal(new Set(result.plan.items.map((item) => item.hook.toLowerCase())).size, result.plan.items.length);
console.log("smm repair loop: ok");
