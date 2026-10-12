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

// Script → plan by rules.
const { cleanScript, scriptToPlan } = await import("../lib/reels/compose.ts");
const script = cleanScript({
  title: "Пока вы спите",
  scenes: [
    { seconds: 2, kind: "сомнение", text: "Пришёл ли заказ?" },
    { seconds: 1.3, kind: "удар", text: "НЕТ. совсем" },
    { seconds: 2, kind: "надпись", text: "Я *сама* напишу клиенту" },
    { seconds: 4, kind: "голосовое", text: "Слушаю", lines: [{ from: "client", text: "Нужен *чёрный*" }, { from: "inna", text: "Есть!" }] },
    { seconds: 3, kind: "выбор", text: "Решаете *вы*", question: "Скидка 10%?" },
    { seconds: 2.6, kind: "уведомление", text: "Новый *заказ*", title: "Пришёл новый заказ" },
    { seconds: 3, kind: "переписка", text: "Ночью", lines: [{ from: "клиент", text: "Есть доставка?" }, { from: "inna", text: "Да, сегодня" }] },
    { seconds: 2, kind: "живая съёмка", text: "Владелец спит" },
  ],
});
assert.equal(script.scenes.at(-1).kind, "надпись", "unknown kind becomes a headline");
const composed = scriptToPlan(script);
assert.deepEqual(composed.errors, []);
const tools = composed.plan.scenes.map((s) => s.tool);
assert.deepEqual(tools, ["glitch", "slam", "headline", "voice", "choice", "notification", "chat", "headline", "outro"]);
assert.equal(composed.plan.scenes[1].params.text, "НЕТ.");
assert.equal(composed.plan.scenes[1].transition, "cut");
assert.equal(composed.plan.scenes[2].transition, "wipe", "after a slam comes a wipe");
assert.equal(composed.plan.scenes.at(-1).transition, "iris");
const voice = composed.plan.scenes[3].params;
assert.equal(voice.transcript, "Нужен *чёрный*");
assert.equal(voice.reply, "Есть!");
assert.deepEqual(composed.plan.scenes[6].params.messages, [{ from: "client", text: "Есть доставка?" }, { from: "me", text: "Да, сегодня" }]);
for (let i = 1; i < composed.plan.scenes.length; i++) {
  const a = composed.plan.scenes[i - 1].params.bg;
  const b = composed.plan.scenes[i].params.bg;
  if (a && b) assert.notEqual(a, b, `scenes ${i} and ${i + 1} share a background`);
}
// Word-boundary cuts and stray accents.
const cut = checkPlan({ scenes: [{ tool: "outro", params: { line: "*ИИнна* — очень длинная строка под логотипом, которая не влезает" } }] });
assert.ok(!cut.plan.scenes[0].params.line.includes("*"));
assert.ok(!/\S$/.test(" ") && cut.plan.scenes[0].params.line.split(" ").every((w) => w.length > 0));
const fake = checkPlan({ scenes: [{ tool: "product", params: { name: "X", image: "https://example.com/a.png" } }] });
assert.ok(!("image" in fake.plan.scenes[0].params), "placeholder image dropped");
console.log("reels compose: ok");
