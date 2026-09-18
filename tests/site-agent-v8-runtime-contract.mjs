import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/site-agent/route.ts", import.meta.url), "utf8");
const runtime = await readFile(new URL("../lib/site-agent-provider-runtime.ts", import.meta.url), "utf8");
const v8 = await readFile(new URL("../lib/site-agent-job-v8.ts", import.meta.url), "utf8");

assert.match(route, /from "@\/lib\/site-agent-job-v8"/, "owner Site Agent route must stay on v8");
assert.match(route, /resolveAISecrets\(ownerKey\)/, "Site Agent must resolve provider keys from Integration Vault");
assert.match(route, /installProviderFailover\(\)/, "active Site Agent must install provider failover");
assert.match(route, /installPersistentProviderGate\(\)/, "active Site Agent must install persistent provider health gate");
assert.match(runtime, /openaiApiKey\?: string/, "resilient runtime must accept a Vault OpenAI key");
assert.match(runtime, /provider: "openai"/, "resilient runtime must expose OpenAI fallback");
assert.match(runtime, /provider: "groq"/, "resilient runtime must keep Groq as primary");
assert.match(v8, /async function calibratedAudit/, "v8 calibrated audit stage must remain present");

console.log("site-agent-v8-runtime-contract: ok");
