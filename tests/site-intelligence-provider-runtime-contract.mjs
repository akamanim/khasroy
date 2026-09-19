import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adapter = await readFile(new URL("../lib/site-agent-v3-provider-runtime.ts", import.meta.url), "utf8");

assert.match(adapter, /siteAgentJson/,
  "Site Intelligence adapter must delegate to the shared Site Agent provider runtime");
assert.match(adapter, /site-agent-provider-runtime\.ts/,
  "Site Intelligence adapter must import the shared provider runtime");
assert.doesNotMatch(adapter, /api\.groq\.com|api\.openai\.com/,
  "Site Intelligence adapter must not re-introduce direct provider endpoints");
assert.doesNotMatch(adapter, /fetch\s*\(/,
  "Site Intelligence adapter must keep provider transport inside the shared runtime");

console.log("Site Intelligence provider adapter contract OK");
