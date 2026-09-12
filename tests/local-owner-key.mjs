import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/ensure-local-owner-key.mjs");
const roots = [];

function tempRoot(name) {
  const root = mkdtempSync(join(tmpdir(), `khasroy-${name}-`));
  roots.push(root);
  return root;
}

function run(cwd, envKey = "") {
  const env = { ...process.env, KHASROY_OWNER_KEY: envKey };
  const result = spawnSync(process.execPath, [script], {
    cwd,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}${result.stderr}`;
}

try {
  const fresh = tempRoot("fresh");
  const freshLog = run(fresh);
  const freshEnv = readFileSync(join(fresh, ".env.local"), "utf8");
  const freshKey = freshEnv.match(/^KHASROY_OWNER_KEY=([a-f0-9]{64})$/m)?.[1];
  assert.ok(freshKey, "fresh bootstrap must create a 256-bit hex owner key");
  assert.ok(!freshLog.includes(freshKey), "generated owner key must never be printed");

  run(fresh);
  const secondEnv = readFileSync(join(fresh, ".env.local"), "utf8");
  assert.equal(secondEnv, freshEnv, "second bootstrap must be idempotent");

  const existing = tempRoot("existing");
  writeFileSync(join(existing, ".env.local"), "KHASROY_OWNER_KEY=my-existing-local-secret\nOTHER=value\n");
  run(existing);
  const existingEnv = readFileSync(join(existing, ".env.local"), "utf8");
  assert.match(existingEnv, /^KHASROY_OWNER_KEY=my-existing-local-secret$/m);
  assert.match(existingEnv, /^OTHER=value$/m);

  const empty = tempRoot("empty");
  writeFileSync(join(empty, ".env.local"), "KHASROY_OWNER_KEY=\nOTHER=value\n");
  const emptyLog = run(empty);
  const emptyEnv = readFileSync(join(empty, ".env.local"), "utf8");
  const replacement = emptyEnv.match(/^KHASROY_OWNER_KEY=([a-f0-9]{64})$/m)?.[1];
  assert.ok(replacement, "empty owner key must be replaced with a random key");
  assert.ok(!emptyLog.includes(replacement), "replacement key must never be printed");
  assert.match(emptyEnv, /^OTHER=value$/m);

  const processProvided = tempRoot("process");
  run(processProvided, "provided-only-in-process");
  assert.equal(existsSync(join(processProvided, ".env.local")), false, "process-level key must not be copied to disk");

  console.log("local owner key bootstrap tests passed");
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
