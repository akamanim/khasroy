import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { installImageFetchHardening } from "@/lib/ai/image-fetch-hardening";
import { installPersistentProviderGate } from "@/lib/ai/persistent-provider-gate";
import { installProviderFailover } from "@/lib/ai/provider-failover";
import { installVisionFailover } from "@/lib/ai/vision-failover";
import { safeEqual } from "@/lib/server-auth";
import { resolveAISecrets } from "@/lib/server-integrations";
import { buildWebsite } from "@/lib/web-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

installImageFetchHardening();
installVisionFailover();
installProviderFailover();
installPersistentProviderGate();

function currentRelease() {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local";
}

function signatureFor(token: string, release: string) {
  return createHmac("sha256", token)
    .update(`web-studio-e2e:${release}`)
    .digest("hex");
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  const vercelToken = (process.env.KHASROY_VERCEL_TOKEN || process.env.VERCEL_TOKEN)?.trim();
  if (!ownerKey || !vercelToken) {
    return NextResponse.json({ error: "selftest_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { runnerRelease?: unknown } | null;
  const runnerRelease = typeof body?.runnerRelease === "string" ? body.runnerRelease.trim() : "";
  const release = currentRelease();
  if (!runnerRelease || runnerRelease !== release) {
    return NextResponse.json({ error: "release_not_live", release }, { status: 409 });
  }

  const provided = request.headers.get("x-khasroy-e2e-signature") || "";
  const expected = signatureFor(vercelToken, runnerRelease);
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "invalid_selftest_signature" }, { status: 401 });
  }

  const ai = await resolveAISecrets(ownerKey).catch(() => ({
    groq: process.env.GROQ_API_KEY?.trim() || "",
    teachers: {},
  }));
  const apiKey = ai.groq;
  if (!apiKey) {
    return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
  }

  try {
    const result = await buildWebsite({
      ownerKey,
      apiKey,
      brief:
        `Создай тестовый production-сайт Khasroy E2E ${runnerRelease}. ` +
        "Это технический smoke test автономной фабрики сайтов. " +
        "Сделай одну страницу на русском: заголовок Khasroy Web Studio E2E, " +
        "услуги Автоматизация, Сайты, AI; форма заявки обязательна.",
      publish: true,
    });
    return NextResponse.json({ ok: true, release, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "web_studio_selftest_failed";
    return NextResponse.json({ ok: false, release, error: message.slice(0, 500) }, { status: 502 });
  }
}
