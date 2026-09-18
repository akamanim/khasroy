import assert from "node:assert/strict";

process.env.GROQ_API_KEY = "groq-test";
process.env.OPENAI_API_KEY = "openai-test";
process.env.OPENAI_SITE_AGENT_MODEL = "test-model";

const { siteAgentJson } = await import("../lib/site-agent-provider-runtime.ts");

const calls = [];
const fetchImpl = async (url) => {
  calls.push(url);
  if (url.includes("groq.com")) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
};

const result = await siteAgentJson({ messages: [{ role: "user", content: "test" }], fetchImpl });
assert.deepEqual(result, { ok: true });
assert.equal(calls.length, 2);
assert.match(calls[0], /groq/);
assert.match(calls[1], /openai/);

console.log("site-agent provider runtime: ok");
