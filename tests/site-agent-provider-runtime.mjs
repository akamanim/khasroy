import assert from "node:assert/strict";

// OpenAI (ChatGPT) is switched off by the owner: even with a key, the runtime never calls it.
process.env.OPENAI_API_KEY = "openai-env-test";
delete process.env.GROQ_API_KEY;

const { siteAgentJson } = await import("../lib/site-agent-provider-runtime.ts");

const calls = [];
const auth = [];
let groqStatus = 429;
const fetchImpl = async (url, init) => {
  calls.push(url);
  auth.push(init?.headers?.Authorization);
  if (url.includes("groq.com") && groqStatus === 429) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
};

groqStatus = 200;
const ok = await siteAgentJson({ messages: [{ role: "user", content: "test" }], fetchImpl, groqApiKey: "legacy-route-key", openaiApiKey: "vault-openai-key" });
assert.deepEqual(ok, { ok: true });
assert.equal(calls.length, 1);
assert.match(calls[0], /groq/);
assert.equal(auth[0], "Bearer legacy-route-key");

calls.length = 0;
groqStatus = 429;
await assert.rejects(
  siteAgentJson({ messages: [{ role: "user", content: "fallback" }], fetchImpl, groqApiKey: "k", openaiApiKey: "vault-openai-key" }),
  /providers exhausted|No Site Agent provider|provider/u,
);
assert.ok(calls.every((url) => !url.includes("openai.com")), "OpenAI must never be called");

calls.length = 0;
await assert.rejects(siteAgentJson({ messages: [{ role: "user", content: "openai only" }], fetchImpl, openaiApiKey: "vault-openai-only" }));
assert.equal(calls.length, 0);

console.log("site-agent provider runtime (OpenAI off): ok");
