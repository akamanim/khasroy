import assert from "node:assert/strict";
import fs from "node:fs";

const adapter = fs.readFileSync("lib/site-agent-v8-provider-runtime.ts", "utf8");

assert.match(adapter, /siteAgentJson/);
assert.match(adapter, /siteAgentV8LegacyJson/);
assert.match(adapter, /groqApiKey/);
assert.match(adapter, /openaiApiKey/);
assert.doesNotMatch(adapter, /api\.groq\.com/);
assert.doesNotMatch(adapter, /api\.openai\.com/);
assert.doesNotMatch(adapter, /await\s+fetch\s*\(/);

console.log("site-agent-v8-provider-adapter-contract: ok");
