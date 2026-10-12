import assert from "node:assert/strict";
import { changePoints } from "../lib/server-github.ts";
import { FEATURES, FEATURE_STATUS } from "../lib/owner-features.ts";

const body = "Текст\n\n- Чат над тучей стал **прозрачнее**\n* Прокрутка `не` тянет\n- третий\n- четвёртый\n\n🤖 Generated with Claude Code\n- не пункт";
assert.deepEqual(changePoints(body), ["Чат над тучей стал прозрачнее", "Прокрутка не тянет", "третий"]);
assert.deepEqual(changePoints(null), []);
assert.equal(changePoints(`- ${"а".repeat(200)}`)[0].length, 138);

const names = new Set();
for (const group of FEATURES) {
  assert.ok(group.items.length, `${group.title} is empty`);
  for (const f of group.items) {
    assert.ok(!names.has(f.name), `duplicate feature ${f.name}`);
    names.add(f.name);
    assert.ok(FEATURE_STATUS[f.status], `${f.name} has an unknown status`);
    assert.ok(!/openai|chatgpt|gpt-4/iu.test(`${f.name} ${f.what}`), `${f.name} mentions OpenAI`);
    if (f.href) assert.match(f.href, /^\//u, `${f.name} links outside the site`);
  }
}
console.log("owner console: ok");
