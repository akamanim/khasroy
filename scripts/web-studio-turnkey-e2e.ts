import fs from "node:fs";
import { runWebStudioTurnkeyE2E } from "../lib/web-studio-e2e";

const release = (process.env.GITHUB_SHA || "runner").slice(0, 12);
const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
if (!ownerKey) throw new Error("KHASROY_OWNER_KEY_MISSING");

const safeResult = await runWebStudioTurnkeyE2E({ ownerKey, release });
fs.writeFileSync("web-studio-e2e-result.json", JSON.stringify(safeResult, null, 2));
console.log(JSON.stringify(safeResult));
