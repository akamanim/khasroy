import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const claim = await readFile(new URL("../supabase/migrations/20260915191500_web_studio_followup_claim_rpc.sql", import.meta.url), "utf8");
const repair = await readFile(new URL("../supabase/migrations/20260915232000_web_studio_followup_finish_repair_rpc.sql", import.meta.url), "utf8");
const approval = await readFile(new URL("../supabase/migrations/20260916012000_web_studio_followup_approval_rpc.sql", import.meta.url), "utf8");

assert.match(approval, /state\s*=\s*'approved'/i, "approval must explicitly enter approved state");
assert.match(claim, /q\.state\s*=\s*'approved'/i, "claim must only consume approved work");
assert.match(claim, /for update skip locked/i, "claim must be concurrency-safe");
assert.match(claim, /attempts\s*=\s*q\.attempts\s*\+\s*1/i, "claim must increment attempts");
assert.match(repair, /q\.state\s*=\s*'claimed'/i, "finish must only complete claimed work");
assert.match(repair, /p_max_attempts/i, "repair must be bounded by max attempts");
assert.match(repair, /for update skip locked/i, "repair must be concurrency-safe");
assert.match(repair, /state\s*=\s*'approved'/i, "repair must return retryable work to approved");
assert.match(repair, /claimed_at\s*<\s*now\(\)\s*-\s*make_interval/i, "repair must detect stale claims");

console.log("web-studio followup worker contract: ok");
