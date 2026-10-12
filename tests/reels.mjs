import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOOLS, catalogForPrompt, checkPlan, wrapLines } from "../lib/reels/catalog.ts";

// Catalog and renderer must list the same tools.
const runtime = await readFile(new URL("../public/reels-runtime/tools.js", import.meta.url), "utf8");
const registered = [...runtime.matchAll(/R\("([a-z_]+)"/g)].map((m) => m[1]).sort();
assert.deepEqual(TOOLS.map((t) => t.name).sort(), registered, "catalog and tools.js must match");

// Shipped example plans are clean.
for (const file of ["iinna-demo.json", "all-tools.json"]) {
  const plan = JSON.parse(await readFile(new URL(`../reels/plans/${file}`, import.meta.url), "utf8"));
  const checked = checkPlan(plan);
  assert.deepEqual(checked.errors, [], `${file}: ${checked.errors.join("; ")}`);
  assert.equal(checked.plan.scenes.length, plan.scenes.length, `${file}: no scene dropped`);
}

// A messy plan, the way a small model might write it, gets repaired.
const messy = checkPlan({
  title: "Тест",
  scenes: [
    { tool: "outro", duration: 2, params: { cta: "Пишите" } },
    { tool: "headline", duration: 99, transition: "spin", params: { text: "Очень длинная фраза которая никак не помещается в одну строку экрана", bg: "pink", extra: 1 } },
    { tool: "dance", duration: 2, params: {} },
    { tool: "product", params: { name: "Cuff *01", image: "javascript:alert(1)" } },
    { tool: "chat", params: { messages: [{ from: "client", text: "Привет" }, { from: "bot", text: "Здравствуйте" }, { text: "" }] } },
    { tool: "choice", params: {} },
  ],
});
assert.equal(messy.plan.scenes.length, 5, "unknown tool dropped");
assert.equal(messy.plan.scenes.at(-1).tool, "outro", "outro moved to the end");
const head = messy.plan.scenes[0];
assert.equal(head.tool, "headline");
assert.equal(head.duration, 4);
assert.equal(head.transition, "cut", "first scene always cuts in");
assert.equal(head.params.bg, "cream");
assert.ok(head.params.text.split("\n").length <= 4 && head.params.text.split("\n").every((l) => l.length <= 16));
assert.ok(!("extra" in head.params));
const product = messy.plan.scenes.find((s) => s.tool === "product");
assert.equal(product.params.name, "Cuff 01", "unmatched star removed");
assert.ok(!("image" in product.params), "unsafe url removed");
const chat = messy.plan.scenes.find((s) => s.tool === "chat");
assert.deepEqual(chat.params.messages, [{ from: "client", text: "Привет" }, { from: "me", text: "Здравствуйте" }]);
assert.ok(messy.errors.some((e) => e.includes("question")), "missing required question reported");
assert.ok(messy.fixes.length >= 5);

assert.equal(wrapLines("Я *сама* напишу клиенту", 10, 3), "Я *сама*\nнапишу\nклиенту");
assert.ok(catalogForPrompt(["brand"]).includes("outro") && !catalogForPrompt(["brand"]).includes("chat"));
console.log("reels catalog: ok");
