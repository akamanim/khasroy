import fs from "node:fs";
import { installImageFetchHardening } from "../lib/ai/image-fetch-hardening";
import { installPersistentProviderGate } from "../lib/ai/persistent-provider-gate";
import { installProviderFailover } from "../lib/ai/provider-failover";
import { installVisionFailover } from "../lib/ai/vision-failover";
import { resolveAISecrets } from "../lib/server-integrations";
import { buildWebsite } from "../lib/web-studio";
import { listSiteLeads } from "../lib/web-studio-editor";

installImageFetchHardening();
installVisionFailover();
installProviderFailover();
installPersistentProviderGate();

const release = (process.env.GITHUB_SHA || "runner").slice(0, 12);
const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
if (!ownerKey) throw new Error("KHASROY_OWNER_KEY_MISSING");

const ai = await resolveAISecrets(ownerKey);
if (!ai.groq) throw new Error("BRAIN_NOT_CONFIGURED");

const built = await buildWebsite({
  ownerKey,
  apiKey: ai.groq,
  brief:
    `Создай тестовый production-сайт Khasroy E2E ${release}. ` +
    "Это технический smoke test автономной фабрики сайтов. " +
    "Сделай одну страницу на русском: заголовок Khasroy Web Studio E2E, " +
    "услуги Автоматизация, Сайты, AI; форма заявки обязательна.",
  publish: true,
});

if (!built.ok) throw new Error("WEB_STUDIO_BUILD_FAILED");
const published = built.published;
if (!published?.repoFullName || !published.repoUrl || !published.deployUrl) {
  throw new Error("PUBLISH_RESULT_INCOMPLETE");
}
if (!published.deploymentReady || !published.httpVerified || !published.databaseLeads) {
  throw new Error("PUBLISH_VERIFICATION_INCOMPLETE");
}

const slug = built.spec.slug;
const markerPhone = `+996700${release.slice(-6)}`;
const form = new URLSearchParams({
  name: "Khasroy E2E",
  phone: markerPhone,
  message: "Automated turnkey Web Studio lead verification",
  website: "",
});
const leadResponse = await fetch(`${published.deployUrl.replace(/\/$/, "")}/api/lead`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: form.toString(),
  redirect: "follow",
});
if (!leadResponse.ok) throw new Error(`LEAD_SUBMIT_HTTP_${leadResponse.status}`);

let observed = false;
let rowsSeen = 0;
for (let attempt = 0; attempt < 10; attempt += 1) {
  const leads = await listSiteLeads(ownerKey, slug, 25);
  rowsSeen = leads.length;
  if (leads.some((lead) => String(lead.phone || "") === markerPhone)) {
    observed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (!observed) throw new Error("SUPABASE_LEAD_NOT_OBSERVED");

const safeResult = {
  ok: true,
  release,
  projectSlug: slug,
  repoFullName: published.repoFullName,
  repoUrl: published.repoUrl,
  vercelProjectId: published.vercelProjectId,
  deployUrl: published.deployUrl,
  deploymentId: published.deploymentId,
  deploymentReady: published.deploymentReady,
  httpVerified: published.httpVerified,
  databaseLeads: published.databaseLeads,
  leadSubmitHttp: leadResponse.status,
  leadObservedInSupabase: observed,
  leadRowsSeen: rowsSeen,
};

fs.writeFileSync("web-studio-e2e-result.json", JSON.stringify(safeResult, null, 2));
console.log(JSON.stringify(safeResult));
