import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = "openai-env-test";
process.env.OPENAI_SITE_AGENT_MODEL = "test-model";
delete process.env.GROQ_API_KEY;

const { siteAgentJson } = await import("../lib/site-agent-provider-runtime.ts");

const calls = [];
const auth = [];
const fetchImpl = async (url, init) => {
  calls.push(url);
  auth.push(init?.headers?.Authorization);
  if (url.includes("groq.com")) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
};

const result = await siteAgentJson({
  messages: [{ role: "user", content: "test" }],
  fetchImpl,
  groqApiKey: "legacy-route-key",
  openaiApiKey: "vault-openai-key",
});
assert.deepEqual(result, { ok: true });
assert.equal(calls.length, 2);
assert.match(calls[0], /groq/);
assert.match(calls[1], /openai/);
assert.equal(auth[0], "Bearer legacy-route-key");
assert.equal(auth[1], "Bearer vault-openai-key");

calls.length = 0;
auth.length = 0;
const openaiOnly = await siteAgentJson({
  messages: [{ role: "user", content: "openai only" }],
  fetchImpl,
  openaiApiKey: "vault-openai-only",
});
assert.deepEqual(openaiOnly, { ok: true });
assert.equal(calls.length, 1);
assert.match(calls[0], /openai/);
assert.equal(auth[0], "Bearer vault-openai-only");

console.log("site-agent provider runtime vault-key failover: ok");
