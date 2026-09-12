import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.local");
const OWNER_KEY_NAME = "KHASROY_OWNER_KEY";

function cleanEnvValue(value) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1$/s);
  return (quoted ? quoted[2] : trimmed).trim();
}

function protectFile(path) {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some filesystems do not expose POSIX permissions. The key remains local
    // because .env* is gitignored; startup must not fail only for chmod.
  }
}

const processKey = process.env[OWNER_KEY_NAME]?.trim();
if (processKey) {
  console.log("[khasroy] local owner key is already provided by the process environment.");
  process.exit(0);
}

let source = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const keyLine = /^(\s*KHASROY_OWNER_KEY\s*=\s*)(.*)$/m;
const match = source.match(keyLine);
const existingValue = match ? cleanEnvValue(match[2]) : "";

if (existingValue) {
  protectFile(ENV_FILE);
  console.log("[khasroy] local owner key is already configured in .env.local.");
  process.exit(0);
}

const generated = randomBytes(32).toString("hex");

if (match) {
  source = source.replace(keyLine, `$1${generated}`);
} else {
  if (source && !source.endsWith("\n")) source += "\n";
  source += `${OWNER_KEY_NAME}=${generated}\n`;
}

writeFileSync(ENV_FILE, source, { encoding: "utf8", mode: 0o600 });
protectFile(ENV_FILE);

console.log("[khasroy] local owner key initialized in .env.local (value hidden).");
