import { spawnSync } from "node:child_process";

const token = process.env.VERCEL_TOKEN?.trim();
if (!token) throw new Error("VERCEL_TOKEN_MISSING");

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

const response = await fetch(
  "https://api.vercel.com/v10/projects/khasroy/env?decrypt=true",
  { headers },
);

if (!response.ok) {
  throw new Error(`VERCEL_ENV_FETCH_HTTP_${response.status}`);
}

type VercelEnv = {
  id?: string;
  key?: string;
  value?: string;
  type?: string;
  target?: string[] | string;
};

const payload = (await response.json()) as { envs?: VercelEnv[] };
const entries = payload.envs || [];
const productionEnv: Record<string, string> = {};

function targetsProduction(entry: VercelEnv) {
  const targets = Array.isArray(entry.target)
    ? entry.target
    : typeof entry.target === "string"
      ? [entry.target]
      : [];
  return targets.length === 0 || targets.includes("production");
}

for (const entry of entries) {
  if (!entry.key || !targetsProduction(entry)) continue;
  if (typeof entry.value === "string" && entry.value) {
    productionEnv[entry.key] = entry.value;
    continue;
  }

  // Vercel can omit the value for sensitive variables from the list endpoint.
  // Fetch those variables individually; never print their values.
  if (!entry.id) continue;
  const single = await fetch(
    `https://api.vercel.com/v1/projects/khasroy/env/${encodeURIComponent(entry.id)}`,
    { headers },
  );
  if (!single.ok) continue;
  const detail = (await single.json()) as { value?: string; key?: string };
  if (typeof detail.value === "string" && detail.value) {
    productionEnv[entry.key] = detail.value;
  }
}

const safeMetadata = entries
  .filter((entry) => entry.key && targetsProduction(entry))
  .map((entry) => ({
    key: entry.key,
    type: entry.type || "unknown",
    hasListValue: typeof entry.value === "string" && entry.value.length > 0,
    resolved: Boolean(entry.key && productionEnv[entry.key]),
  }))
  .sort((a, b) => String(a.key).localeCompare(String(b.key)));
console.log("Vercel production env metadata:", JSON.stringify(safeMetadata));

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
