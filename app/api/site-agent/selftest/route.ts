import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { recallKnowledge, rememberKnowledge } from "@/lib/server-memory";
import {
  createSiteAgentJob,
  stepSiteAgentJob,
} from "@/lib/site-agent-job-v7";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SELFTEST_KEY = "site_agent_selftest_latest";
const SELFTEST_CATEGORY = "site_agent_selftest";
const TARGET_URL = "https://prombaza.vercel.app";
const GOAL =
  "Проведи полный аудит сайта https://prombaza.vercel.app, изучи реальный бизнес и контент сайта, сделай полноценный редизайн и прогони repair loop.";

type SelfTestState = {
  release: string;
  targetUrl: string;
  jobId: string;
  status: "running" | "done" | "failed";
  stage: string;
  progress: string;
  steps: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  content?: string;
  error?: string;
  retryAfterMs?: number;
};

function currentRelease() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    "local"
  );
}

async function loadState(ownerKey: string) {
  const items = await recallKnowledge(ownerKey, SELFTEST_KEY, 8);
  const item = items.find(
    (entry) =>
      entry.memory_key === SELFTEST_KEY &&
      entry.category === SELFTEST_CATEGORY,
  );
  if (!item) return null;
  try {
    return JSON.parse(item.content) as SelfTestState;
  } catch {
    return null;
  }
}

async function saveState(ownerKey: string, state: SelfTestState) {
  state.updatedAt = new Date().toISOString();
  await rememberKnowledge(
    ownerKey,
    SELFTEST_KEY,
    SELFTEST_CATEGORY,
    JSON.stringify(state),
    1,
  );
}

async function ensureState(ownerKey: string, origin: string) {
  const release = currentRelease();
  const existing = await loadState(ownerKey);
  if (existing?.release === release) return existing;

  const created = await createSiteAgentJob({
    ownerKey,
    origin,
    targetUrl: TARGET_URL,
    goal: GOAL,
  });

  const now = new Date().toISOString();
  const state: SelfTestState = {
    release,
    targetUrl: TARGET_URL,
    jobId: created.jobId,
    status: "running",
    stage: created.stage,
    progress: created.progress,
    steps: 0,
    startedAt: now,
    updatedAt: now,
    retryAfterMs: created.retryAfterMs,
  };
  await saveState(ownerKey, state);
  return state;
}

function publicState(state: SelfTestState) {
  return {
    release: state.release,
    targetUrl: state.targetUrl,
    jobId: state.jobId,
    status: state.status,
    stage: state.stage,
    progress: state.progress,
    steps: state.steps,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    content: state.content,
    error: state.error,
    retryAfterMs: state.retryAfterMs,
  };
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!ownerKey || !apiKey) {
    return NextResponse.json(
      { error: "Self-test не настроен на сервере." },
      { status: 503 },
    );
  }

  let body: { action?: unknown; runnerRelease?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body means status/ensure for an authenticated owner.
  }
  const action = body.action === "step" ? "step" : body.action === "status" ? "status" : "ensure";
  const release = currentRelease();
  const releaseRunner =
    (action === "ensure" || action === "step") &&
    typeof body.runnerRelease === "string" &&
    body.runnerRelease === release;

  if (!releaseRunner) {
    const cookieStore = await cookies();
    const session = cookieStore.get(OWNER_COOKIE)?.value;
    if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
      if (typeof body.runnerRelease === "string") {
        return NextResponse.json(
          { error: "release_not_live", release },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Требуется доступ владельца." }, { status: 401 });
    }
  }

  try {
    let state = action === "status" ? await loadState(ownerKey) : await ensureState(ownerKey, new URL(request.url).origin);
    if (!state) {
      return NextResponse.json({ ok: true, status: "idle", release });
    }

    if (action !== "step" || state.status !== "running") {
      return NextResponse.json({ ok: true, ...publicState(state) });
    }

    try {
      const result = await stepSiteAgentJob({
        ownerKey,
        apiKey,
        jobId: state.jobId,
      });
      state.stage = result.stage;
      state.progress = result.progress;
      state.steps += 1;
      state.retryAfterMs = result.retryAfterMs;

      if (result.done) {
        state.status = "done";
        state.completedAt = new Date().toISOString();
        state.content = result.content || "Self-test завершён без текстового отчёта.";
        state.retryAfterMs = undefined;
      }
      await saveState(ownerKey, state);
      return NextResponse.json({ ok: true, ...publicState(state) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Self-test step failed";
      const retryable = /(timeout|AbortError|429|rate limit|screenshot|temporar|memory)/iu.test(message);
      if (retryable) {
        state.progress = `Self-test: временная ошибка этапа, повторю его позже — ${message.slice(0, 180)}`;
        state.retryAfterMs = /429|rate limit/iu.test(message) ? 65_000 : 3_000;
        await saveState(ownerKey, state);
        return NextResponse.json({ ok: true, retryable: true, ...publicState(state) });
      }

      state.status = "failed";
      state.error = message.slice(0, 500);
      state.completedAt = new Date().toISOString();
      state.retryAfterMs = undefined;
      await saveState(ownerKey, state);
      return NextResponse.json({ ok: true, ...publicState(state) });
    }
  } catch (error) {
    console.error("Khasroy Site Agent self-test failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Self-test unavailable" },
      { status: 502 },
    );
  }
}
