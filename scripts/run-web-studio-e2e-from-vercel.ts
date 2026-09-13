import { spawnSync } from "node:child_process";

const token = process.env.VERCEL_TOKEN?.trim();
if (!token) throw new Error("VERCEL_TOKEN_MISSING");

const response = await fetch(
  "https://api.vercel.com/v10/projects/khasroy/env?decrypt=true",
  {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  },
);

if (!response.ok) {
  throw new Error(`VERCEL_ENV_FETCH_HTTP_${response.status}`);
}

const payload = (await response.json()) as {
  envs?: Array<{
    key?: string;
    value?: string;
    target?: string[] | string;
  }>;
};

const productionEnv: Record<string, string> = {};
for (const entry of payload.envs || []) {
  if (!entry.key || typeof entry.value !== "string") continue;
  const targets = Array.isArray(entry.target)
    ? entry.target
    : typeof entry.target === "string"
      ? [entry.target]
      : [];
  if (targets.length > 0 && !targets.includes("production")) continue;
  productionEnv[entry.key] = entry.value;
}

const required = ["KHASROY_OWNER_KEY"];
for (const key of required) {
  if (!productionEnv[key] && !process.env[key]) {
    throw new Error(`VERCEL_PRODUCTION_ENV_MISSING_${key}`);
  }
}

console.log(`Loaded ${Object.keys(productionEnv).length} production environment variables from Vercel REST API.`);

const child = spawnSync(
  "npx",
  ["--yes", "tsx", "scripts/web-studio-turnkey-e2e.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...productionEnv,
      VERCEL_TOKEN: token,
    },
  },
);

if (child.error) throw child.error;
if (child.status !== 0) {
  throw new Error(`WEB_STUDIO_E2E_CHILD_EXIT_${child.status ?? "UNKNOWN"}`);
}
