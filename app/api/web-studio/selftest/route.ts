import { createPublicKey, verify as verifySignature } from "node:crypto";
import { NextResponse } from "next/server";
import { installImageFetchHardening } from "@/lib/ai/image-fetch-hardening";
import { installPersistentProviderGate } from "@/lib/ai/persistent-provider-gate";
import { installProviderFailover } from "@/lib/ai/provider-failover";
import { installVisionFailover } from "@/lib/ai/vision-failover";
import { resolveAISecrets } from "@/lib/server-integrations";
import { buildWebsite } from "@/lib/web-studio";
import { listSiteLeads } from "@/lib/web-studio-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

installImageFetchHardening();
installVisionFailover();
installProviderFailover();
installPersistentProviderGate();

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "khasroy-webstudio-e2e";
const EXPECTED_REPOSITORY = "akamanim/khasroy";
const EXPECTED_REF = "refs/heads/main";
const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

type JwtHeader = { alg?: string; kid?: string };
type GithubClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  event_name?: string;
};
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

function decodePart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

async function verifyGithubOidc(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  let header: JwtHeader;
  let claims: GithubClaims;
  try {
    header = decodePart<JwtHeader>(parts[0]);
    claims = decodePart<GithubClaims>(parts[1]);
  } catch {
    return false;
  }

  if (header.alg !== "RS256" || !header.kid) return false;
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== OIDC_ISSUER ||
    !audience.includes(OIDC_AUDIENCE) ||
    claims.repository !== EXPECTED_REPOSITORY ||
    claims.ref !== EXPECTED_REF ||
    !["push", "workflow_dispatch"].includes(claims.event_name || "") ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    (typeof claims.nbf === "number" && claims.nbf > now + 30)
  ) {
    return false;
  }

  try {
    const response = await fetch(JWKS_URL, { cache: "no-store" });
    if (!response.ok) return false;
    const payload = (await response.json()) as { keys?: Jwk[] };
    const jwk = payload.keys?.find((entry) => entry.kid === header.kid);
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    return false;
  }
}

function currentRelease() {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local";
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !(await verifyGithubOidc(token))) {
    return NextResponse.json({ error: "invalid_ci_identity" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { runnerRelease?: unknown } | null;
  const runnerRelease = typeof body?.runnerRelease === "string" ? body.runnerRelease.trim() : "";
  const release = currentRelease();
  if (!runnerRelease || runnerRelease !== release) {
    return NextResponse.json({ error: "release_not_live", release }, { status: 409 });
  }

  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }

  const ai = await resolveAISecrets(ownerKey).catch(() => ({
    groq: process.env.GROQ_API_KEY?.trim() || "",
    teachers: {},
  }));
  if (!ai.groq) {
    return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
  }

  try {
    const built = await buildWebsite({
      ownerKey,
      apiKey: ai.groq,
      brief:
        `Создай тестовый production-сайт Khasroy E2E ${runnerRelease}. ` +
        "Это технический smoke test автономной фабрики сайтов. " +
        "Сделай одну страницу на русском: заголовок Khasroy Web Studio E2E, " +
        "услуги Автоматизация, Сайты, AI; форма заявки обязательна.",
      publish: true,
    });

    if (!built.published?.repoFullName || !built.published.repoUrl || !built.published.deployUrl) {
      throw new Error("publish_result_incomplete");
    }
    if (!built.published.deploymentReady || !built.published.httpVerified || !built.published.databaseLeads) {
      throw new Error("publish_verification_incomplete");
    }

    const markerPhone = `+996700${runnerRelease.slice(-6)}`;
    const leadBody = new URLSearchParams({
      name: "Khasroy E2E",
      phone: markerPhone,
      message: "Automated turnkey Web Studio lead verification",
      website: "",
    });
    const leadResponse = await fetch(`${built.published.deployUrl.replace(/\/$/, "")}/api/lead`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: leadBody.toString(),
      redirect: "follow",
    });
    if (!leadResponse.ok) throw new Error(`lead_submit_http_${leadResponse.status}`);

    let observed = false;
    let leadRowsSeen = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const leads = await listSiteLeads(ownerKey, built.spec.slug, 25);
      leadRowsSeen = leads.length;
      if (leads.some((lead) => String(lead.phone || "") === markerPhone)) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!observed) throw new Error("supabase_lead_not_observed");

    return NextResponse.json({
      ok: true,
      release,
      projectSlug: built.spec.slug,
      repoFullName: built.published.repoFullName,
      repoUrl: built.published.repoUrl,
      vercelProjectId: built.published.vercelProjectId,
      deployUrl: built.published.deployUrl,
      deploymentId: built.published.deploymentId,
      deploymentReady: built.published.deploymentReady,
      httpVerified: built.published.httpVerified,
      databaseLeads: built.published.databaseLeads,
      leadSubmitHttp: leadResponse.status,
      leadObservedInSupabase: observed,
      leadRowsSeen,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "web_studio_selftest_failed";
    return NextResponse.json({ ok: false, release, error: message.slice(0, 500) }, { status: 502 });
  }
}
