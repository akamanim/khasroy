import { NextResponse } from "next/server";
import { recallKnowledge, rememberKnowledge } from "@/lib/server-memory";
import { runWebStudioTurnkeyE2E, type WebStudioTurnkeyE2EResult } from "@/lib/web-studio-e2e";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The turnkey factory creates a GitHub repository, provisions a Vercel project,
// waits for its production deployment, verifies HTTP, then submits and checks a
// Supabase lead. Sixty seconds was shorter than the real critical path and caused
// the CI runner to repeatedly restart the same side-effectful test.
export const maxDuration = 300;

const CATEGORY = "web_studio_e2e";

function currentRelease() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "local"
  );
}

function cacheKey(release: string) {
  return `web_studio_e2e_${release}`;
}

async function loadCached(ownerKey: string, release: string) {
  const key = cacheKey(release);
  const rows = await recallKnowledge(ownerKey, key, 6).catch(() => []);
  const row = rows.find((item) => item.memory_key === key && item.category === CATEGORY);
  if (!row?.content) return null;
  try {
    const parsed = JSON.parse(row.content) as WebStudioTurnkeyE2EResult;
    return parsed?.ok ? parsed : null;
  } catch {
    return null;
  }
}

async function saveCached(ownerKey: string, release: string, result: WebStudioTurnkeyE2EResult) {
  await rememberKnowledge(
    ownerKey,
    cacheKey(release),
    CATEGORY,
    JSON.stringify(result),
    1,
  );
}

export async function POST(request: Request) {
  const release = currentRelease();
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured", release }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { runnerRelease?: unknown } | null;
  const runnerRelease = typeof body?.runnerRelease === "string" ? body.runnerRelease.trim() : "";
  if (!runnerRelease || runnerRelease !== release) {
    return NextResponse.json({ error: "release_not_live", release }, { status: 409 });
  }

  const cached = await loadCached(ownerKey, release);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const result = await runWebStudioTurnkeyE2E({ ownerKey, release });
    await saveCached(ownerKey, release, result).catch((error) => {
      console.error("Web Studio E2E cache write failed", error);
    });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "web_studio_e2e_failed";
    console.error("Web Studio turnkey self-test failed", error);
    const transient = /(429|rate.?limit|quota|api-deployments-free-per-day|resource is limited|timeout|temporar|503|deployment_not_ready)/iu.test(detail);
    return NextResponse.json(
      {
        ok: false,
        error: transient ? "web_studio_e2e_temporarily_blocked" : "web_studio_e2e_failed",
        detail: detail.slice(0, 600),
        release,
        retryable: transient,
      },
      { status: transient ? 503 : 502 },
    );
  }
}
