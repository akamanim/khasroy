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
const loose = (t) => (["typewriter", "ticker"].includes(t) ? "headline" : t);
assert.deepEqual(tools.map(loose), ["glitch", "slam", "headline", "voice", "choice", "notification", "chat", "headline", "outro"]);
assert.equal(composed.plan.scenes[1].params.text, "НЕТ.");
const sc = composed.plan.scenes;
assert.ok(["cut", "glitch"].includes(sc[1].transition), "slam lands hard");
assert.ok(["slab", "whip", "split"].includes(sc[2].transition), "after a slam comes a big move");
assert.ok(["iris", "slab", "zoom"].includes(sc.at(-1).transition), "outro has a closing move");
for (let i = 2; i < sc.length; i++) assert.notEqual(sc[i].transition, sc[i - 1].transition, `transition repeats at scene ${i + 1}`);
assert.ok(composed.plan.style && composed.plan.bpm && composed.plan.seed !== undefined, "plan carries style, bpm, seed");
const beat = 60 / composed.plan.bpm;
for (const s of sc) {
  const n = s.duration / beat;
  assert.ok(Math.abs(n - Math.round(n)) < 0.02, `${s.tool} lasts ${s.duration}s, not on the beat (${beat.toFixed(3)}s)`);
}
assert.deepEqual(scriptToPlan(script, 42).plan, scriptToPlan(script, 42).plan, "same seed, same reel");
const looks = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(scriptToPlan(script, seed).plan.scenes.map((s) => [s.transition, s.params.variant]))));
assert.ok(looks.size >= 4, "different seeds give different reels");
// Looks: three looks over one script give three different reels.
const lookPlans = ["punch", "night", "paper"].map((look) => scriptToPlan(script, 7, { look }).plan);
assert.equal(new Set(lookPlans.map((p) => p.theme)).size, 3, "each look has its own theme");
assert.equal(new Set(lookPlans.map((p) => JSON.stringify(p.scenes.map((s) => s.transition)))).size, 3, "each look moves differently");
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

const tutorial = scriptToPlan(cleanScript({ scenes: [
  { kind: "надпись", text: "За *3* шага" },
  { kind: "экран", text: "Товары", section: "Товары и услуги" },
  { kind: "товар", text: "Хит" },
  { kind: "экран", text: "Интеграции" },
  { kind: "уведомление", text: "Подключено!" },
  { kind: "надпись", text: "" , what: "" },
] }));
const t = tutorial.plan.scenes;
assert.deepEqual(t.map((s) => s.tool), ["headline", "screen", "screen", "notification", "outro"], "nameless product and empty headline dropped");
assert.equal(t[1].params.step, "01 / 02");
assert.equal(t[2].params.step, "02 / 02");
assert.equal(t[3].params.title, "Подключено!");
console.log("reels compose 2: ok");

// Creative kinds become their tools with sensible parameters.
const creative = scriptToPlan(cleanScript({ scenes: [
  { kind: "бегущая строка", text: "24/7" },
  { kind: "завал", text: "Директ *горит*", items: ["Цена?", "Есть размер M?"] },
  { kind: "ночь", text: "Пока вы *спите*" },
  { kind: "до/после", text: "Разница", before: ["Ответ через час"], items: ["Ответ сразу"] },
  { kind: "смена слов", text: "ИИнна", items: ["отвечает", "продаёт"] },
  { kind: "печать", text: "Сейчас уточню" },
  { kind: "реакция", text: "Заказ!" },
] }), 3, { look: "acid" });
assert.deepEqual(creative.errors, []);
assert.deepEqual(creative.plan.scenes.map((s) => s.tool), ["ticker", "pile", "night", "compare", "swap", "typewriter", "burst", "outro"]);
assert.deepEqual(creative.plan.scenes[1].params.messages, ["Цена?", "Есть размер M?"]);
assert.deepEqual(creative.plan.scenes[3].params.after, ["Ответ сразу"]);
assert.equal(creative.plan.theme, "acid");
console.log("reels creative: ok");

// The storyboard maps plan scenes back to script scenes.
{
  const { planSources } = await import("../lib/reels/compose.ts");
  const sc = cleanScript({ scenes: [{ kind: "надпись", text: "А" }, { kind: "товар", text: "без имени" }, { kind: "удар", text: "Да" }] });
  const plan = scriptToPlan(sc, 1).plan;
  assert.deepEqual(planSources(sc), [0, 2, -1]);
  assert.equal(plan.scenes.length, 3);
  const photo = scriptToPlan(cleanScript({ scenes: [{ kind: "фото", text: "Наш *цех*", image: "https://x.supabase.co/a.jpg" }] }), 2, { look: "paper", bpm: 100 });
  assert.equal(photo.plan.scenes[0].tool, "photo");
  assert.equal(photo.plan.scenes[0].params.variant, "card");
  assert.equal(photo.plan.bpm, 100);
  const track = checkPlan({ ...photo.plan, music: "track", track: "https://x.supabase.co/song.mp3", trackOffset: 12.5 });
  assert.equal(track.plan.music, "track");
  assert.equal(track.plan.trackOffset, 12.5);
  console.log("reels sources/photo/track: ok");
}
