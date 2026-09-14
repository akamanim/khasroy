import assert from "node:assert/strict";
import { renderGitHubStagingProject, stagingSourceFingerprint } from "../lib/web-studio-github-staging.ts";

const spec = {
  projectName: "Demo",
  slug: "demo",
  brandName: "Demo",
  tagline: "Сайт для бизнеса",
  description: "Проверка staging sync",
  audience: "Клиенты",
  primaryCta: "Оставить заявку",
  secondaryCta: "Услуги",
  contactText: "Свяжитесь с нами",
  services: ["Сайт", "Поддержка"],
  advantages: ["Быстро", "Надёжно"],
  palette: { background: "#071019", surface: "#101c27", text: "#f7fbff", muted: "#9fb1bf", accent: "#6ee7d8" },
  style: "premium modern",
  leadForm: true,
};

const first = stagingSourceFingerprint(spec, "demo");
const second = stagingSourceFingerprint(structuredClone(spec), "demo");
assert.equal(first, second, "same site spec must keep the same staging source fingerprint");

const changed = structuredClone(spec);
changed.tagline = "Новый оффер";
assert.notEqual(stagingSourceFingerprint(changed, "demo"), first, "site edits must invalidate the staging source fingerprint");
assert.notEqual(stagingSourceFingerprint(spec, "demo-2"), first, "project identity must be part of the fingerprint");

const files = renderGitHubStagingProject(spec, "demo");
const provenance = JSON.parse(files[".khasroy/staging.json"]);
assert.equal(provenance.target, "github-staging");
assert.equal(provenance.projectSlug, "demo");
assert.equal(provenance.productionUntouched, true);

console.log("web-studio GitHub staging regression: ok");
