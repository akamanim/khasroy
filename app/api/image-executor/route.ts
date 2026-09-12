import { createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { recordChatImageGenerationTrial } from "@/lib/server-learning";
import { recallKnowledge, rememberKnowledge } from "@/lib/server-memory";
import {
  compileImagePrompt,
  loadImageGenerationLessons,
  verifyGeneratedImage,
  type ImageSemanticAudit,
} from "@/lib/server-image-verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 2;
const COMPUTE_BUDGET_MS = 54_000;
const MIN_REPAIR_BUDGET_MS = 11_000;
const GATEWAY_IMAGE_ENDPOINT = "https://ai-gateway.vercel.sh/v1/images/generations";
const PER_MODEL_TIMEOUT_MS = 13_000;

const DOCUMENTED_IMAGE_MODELS = [
  "bfl/flux-2-pro",
  "openai/gpt-image-2",
  "xai/grok-imagine-image",
  "google/imagen-4.0-ultra-generate-001",
];

const ACCEPTANCE_THRESHOLDS = Object.freeze({
  subjectMatch: 72,
  sceneMatch: 62,
  requestMatch: 72,
  overall: 70,
});

type AcceptanceContract = {
  version: 1;
  requestHash: string;
  prompt: string;
  maxAttempts: number;
  thresholds: typeof ACCEPTANCE_THRESHOLDS;
};

type GeneratedImage = {
  image: string;
  mediaType: string;
  provider: "vercel-ai-gateway";
  requestedModel: string;
  actualModel: string;
};

type TechnicalFailure = {
  code: string;
  stage: "generation" | "verification" | "budget";
  detail: string;
  retryable: boolean;
};

type GatewayImagePayload = {
  model?: string;
  data?: Array<{ b64_json?: string | null; url?: string | null }>;
  error?: { message?: string; code?: string };
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function acceptanceContract(prompt: string): AcceptanceContract {
  const clean = prompt.replace(/\s+/gu, " ").trim().slice(0, 1800);
  return {
    version: 1,
    requestHash: hash(clean).slice(0, 24),
    prompt: clean,
    maxAttempts: MAX_ATTEMPTS,
    thresholds: ACCEPTANCE_THRESHOLDS,
  };
}

function applyContract(audit: ImageSemanticAudit, contract: AcceptanceContract): ImageSemanticAudit {
  const passed =
    !audit.criticalMismatch &&
    audit.subjectMatch >= contract.thresholds.subjectMatch &&
    audit.sceneMatch >= contract.thresholds.sceneMatch &&
    audit.requestMatch >= contract.thresholds.requestMatch &&
    audit.overall >= contract.thresholds.overall;
  return {
    ...audit,
    passed,
    score: Number((Math.max(0, Math.min(100, audit.overall)) / 100).toFixed(3)),
  };
}

function technicalFailure(stage: TechnicalFailure["stage"], error: unknown): TechnicalFailure {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  const lower = message.toLowerCase();
  let code = `${stage}_failed`;
  let retryable = true;
  if (/429|rate.?limit|quota|cooling.?down|temporar/u.test(lower)) code = `${stage}_rate_limited`;
  else if (/timeout|abort/u.test(lower)) code = `${stage}_timeout`;
  else if (/401|403|unauthor|forbidden/u.test(lower)) {
    code = `${stage}_configuration_error`;
    retryable = false;
  }
  return { code, stage, detail: message.slice(0, 700), retryable };
}

function compactProviderPrompt(prompt: string, maxChars = 1400) {
  return prompt.replace(/\s+/gu, " ").trim().slice(0, maxChars);
}

async function gatewayToken() {
  const configured = process.env.AI_GATEWAY_API_KEY?.trim();
  if (configured) return configured;
  return getVercelOidcToken({ expirationBufferMs: 2 * 60_000 });
}

function imageModels() {
  const configured = process.env.KHASROY_IMAGE_GENERATION_MODEL?.trim();
  return [...new Set([configured, ...DOCUMENTED_IMAGE_MODELS].filter(Boolean) as string[])];
}

async function fetchImageUrl(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const mediaType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!response.ok || !/^image\/(?:png|jpeg|jpg|webp)$/iu.test(mediaType)) {
    throw new Error(`gateway_image_url_${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { image: `data:${mediaType};base64,${bytes.toString("base64")}`, mediaType };
}

async function requestGatewayImage(args: {
  token: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}): Promise<GeneratedImage> {
  const response = await fetch(GATEWAY_IMAGE_ENDPOINT, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs),
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      prompt: compactProviderPrompt(args.prompt),
      n: 1,
      response_format: "b64_json",
    }),
  });

  const payload = (await response.json().catch(() => null)) as GatewayImagePayload | null;
  if (!response.ok) {
    throw new Error(
      `${args.model}:${response.status}:${payload?.error?.message || payload?.error?.code || "gateway_image_error"}`,
    );
  }

  const item = payload?.data?.[0];
  if (item?.b64_json) {
    return {
      image: `data:image/png;base64,${item.b64_json}`,
      mediaType: "image/png",
      provider: "vercel-ai-gateway",
      requestedModel: args.model,
      actualModel: payload?.model || args.model,
    };
  }

  if (item?.url) {
    const downloaded = await fetchImageUrl(item.url, Math.min(8_000, args.timeoutMs));
    return {
      ...downloaded,
      provider: "vercel-ai-gateway",
      requestedModel: args.model,
      actualModel: payload?.model || args.model,
    };
  }

  throw new Error(`${args.model}:gateway_returned_no_image`);
}

async function generateWithGatewayFailover(args: {
  prompt: string;
  deadline: number;
  reserveMs: number;
  avoidModel?: string;
}): Promise<GeneratedImage> {
  const token = await gatewayToken();
  const models = imageModels().filter((model) => model !== args.avoidModel);
  const errors: string[] = [];

  for (const model of models) {
    const remaining = args.deadline - Date.now() - args.reserveMs;
    if (remaining < 5_000) break;
    const timeoutMs = Math.max(5_000, Math.min(PER_MODEL_TIMEOUT_MS, remaining));
    try {
      return await requestGatewayImage({ token, model, prompt: args.prompt, timeoutMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown");
      errors.push(message.slice(0, 220));
    }
  }

  throw new Error(`all_gateway_image_models_failed=${errors.join(" | ").slice(0, 680) || "no_model_budget"}`);
}

async function loadConfirmedLessons(ownerKey: string) {
  return Promise.race([
    loadImageGenerationLessons(ownerKey, 2),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1_500)),
  ]).catch(() => [] as string[]);
}

function lessonPattern(audit: ImageSemanticAudit) {
  const material = [audit.mismatches.slice(0, 3).join("; "), audit.repairPrompt]
    .join(" | ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  return hash(material).slice(0, 20);
}

async function quarantineLesson(
  ownerKey: string,
  contract: AcceptanceContract,
  audit: ImageSemanticAudit,
) {
  const fingerprint = lessonPattern(audit);
  const candidateKey = `image_generation_lesson_candidate_${fingerprint}`;
  const confirmedKey = `image_generation_lesson_${fingerprint}`;
  const rows = await recallKnowledge(ownerKey, candidateKey, 6).catch(() => []);
  const previous = rows.find((row) => row.memory_key === candidateKey);
  let previousRequestHash = "";
  if (previous?.content) {
    try {
      const parsed = JSON.parse(previous.content) as { requestHash?: string };
      previousRequestHash = typeof parsed.requestHash === "string" ? parsed.requestHash : "";
    } catch {
      previousRequestHash = "";
    }
  }

  const material = [
    `Mismatch: ${audit.mismatches.join("; ").slice(0, 700) || "semantic verification failed"}`,
    `Repair guidance: ${audit.repairPrompt.slice(0, 500)}`,
  ].join(" | ");

  await rememberKnowledge(
    ownerKey,
    candidateKey,
    "image_generation_lesson_candidate",
    JSON.stringify({
      requestHash: contract.requestHash,
      pattern: fingerprint,
      material,
      observedAt: new Date().toISOString(),
    }),
    0.7,
  );

  const confirmed = Boolean(previousRequestHash && previousRequestHash !== contract.requestHash);
  if (confirmed) {
    await rememberKnowledge(
      ownerKey,
      confirmedKey,
      "image_generation_lesson",
      `${material} | Confirmed across distinct image requests.`,
      0.9,
    );
  }
  return { confirmed, fingerprint };
}

async function saveLessonBounded(
  ownerKey: string,
  contract: AcceptanceContract,
  audit: ImageSemanticAudit,
) {
  return Promise.race([
    quarantineLesson(ownerKey, contract, audit),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500)),
  ]).catch(() => null);
}

async function rememberTechnicalInterruption(
  ownerKey: string,
  contract: AcceptanceContract,
  failure: TechnicalFailure,
  attempt: number,
  audit: ImageSemanticAudit | null,
) {
  return rememberKnowledge(
    ownerKey,
    `image_executor_technical_${Date.now()}`,
    "image_generation_technical",
    JSON.stringify({
      requestHash: contract.requestHash,
      code: failure.code,
      stage: failure.stage,
      detail: failure.detail,
      attempt,
      lastAudit: audit
        ? {
            subjectMatch: audit.subjectMatch,
            sceneMatch: audit.sceneMatch,
            requestMatch: audit.requestMatch,
            overall: audit.overall,
            criticalMismatch: audit.criticalMismatch,
          }
        : null,
      observedAt: new Date().toISOString(),
    }),
    0.85,
  ).catch(() => undefined);
}

export async function POST(request: Request) {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ error: "prompt_required" }, { status: 400 });

  const apiKey = process.env.GROQ_API_KEY?.trim() || "";
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        failureClass: "technical",
        code: "visual_verifier_not_configured",
        error: "Визуальный экзаменатор сейчас не настроен, поэтому я не буду выдавать непроверенную картинку.",
        retryable: false,
      },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  const deadline = startedAt + COMPUTE_BUDGET_MS;
  const contract = acceptanceContract(prompt);
  const lessons = await loadConfirmedLessons(ownerKey);
  const audits: ImageSemanticAudit[] = [];
  let finalImage: GeneratedImage | null = null;
  let repairPrompt = "";
  let techFailure: TechnicalFailure | null = null;
  let repairInterrupted: TechnicalFailure | null = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= contract.maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (attempt > 1 && remaining < MIN_REPAIR_BUDGET_MS) {
      repairInterrupted = {
        code: "retry_skipped_time_budget",
        stage: "budget",
        detail: `remaining_compute_budget_ms=${Math.max(0, remaining)}`,
        retryable: true,
      };
      break;
    }

    attempts = attempt;
    const compiledPrompt = compileImagePrompt(contract.prompt, {
      lessons,
      repairPrompt: attempt > 1 ? repairPrompt : undefined,
    });

    let image: GeneratedImage;
    try {
      image = await generateWithGatewayFailover({
        prompt: compiledPrompt,
        deadline,
        reserveMs: 10_000,
        avoidModel: attempt > 1 ? finalImage?.actualModel : undefined,
      });
    } catch (error) {
      const failure = technicalFailure("generation", error);
      if (attempt > 1 && finalImage && audits.length) {
        repairInterrupted = failure;
        await rememberTechnicalInterruption(ownerKey, contract, failure, attempt, audits[audits.length - 1]);
        break;
      }
      techFailure = failure;
      break;
    }

    let audit: ImageSemanticAudit;
    try {
      audit = applyContract(
        await verifyGeneratedImage({
          apiKey,
          prompt: contract.prompt,
          imageDataUrl: image.image,
        }),
        contract,
      );
    } catch (error) {
      techFailure = technicalFailure("verification", error);
      break;
    }

    finalImage = image;
    audits.push(audit);
    if (audit.passed) break;
    repairPrompt = audit.repairPrompt;
  }

  const lastAudit = audits[audits.length - 1] || null;
  if (lastAudit && !lastAudit.passed) {
    await saveLessonBounded(ownerKey, contract, lastAudit);
  }

  if (techFailure) {
    await rememberTechnicalInterruption(ownerKey, contract, techFailure, attempts, lastAudit);
    return NextResponse.json(
      {
        ok: false,
        failureClass: "technical",
        code: techFailure.code,
        error: "Технический ресурс прервал генерацию или проверку. Это не считается провалом навыка; экзамен остаётся незавершённым.",
        detail: techFailure.detail,
        retryable: techFailure.retryable,
        attempts,
        audit: lastAudit,
        acceptanceContract: {
          requestHash: contract.requestHash,
          thresholds: contract.thresholds,
          maxAttempts: contract.maxAttempts,
        },
      },
      { status: techFailure.retryable ? 503 : 502 },
    );
  }

  if (!finalImage || !lastAudit) {
    return NextResponse.json(
      {
        ok: false,
        failureClass: "technical",
        code: "executor_empty_result",
        error: "Image Executor не получил проверяемого результата. Экзамен не засчитан.",
        retryable: true,
      },
      { status: 503 },
    );
  }

  const learning = await recordChatImageGenerationTrial(ownerKey, {
    prompt: contract.prompt,
    model: `${finalImage.provider}-${finalImage.actualModel}`,
    mediaType: finalImage.mediaType,
    mode: "executor_v6_rest_failover",
    runtimeMs: Date.now() - startedAt,
    attempts,
    audit: lastAudit,
  }).catch((error) => {
    console.error("Khasroy executor learning write failed", error);
    return null;
  });

  if (!lastAudit.passed) {
    return NextResponse.json(
      {
        ok: false,
        failureClass: "semantic",
        code: "image_semantic_verification_failed",
        error: repairInterrupted
          ? "Первая картинка была реально создана и проверена, но не прошла визуальный экзамен. Повторная генерация по замечаниям временно недоступна; провал записан в обучение."
          : "Я закончил разрешённые попытки, но финальная картинка не прошла визуальный экзамен. Провал записан в обучение.",
        retryable: Boolean(repairInterrupted?.retryable),
        attempts,
        audit: lastAudit,
        learning,
        repairInterrupted: repairInterrupted
          ? { code: repairInterrupted.code, detail: repairInterrupted.detail }
          : null,
        acceptanceContract: {
          requestHash: contract.requestHash,
          thresholds: contract.thresholds,
          maxAttempts: contract.maxAttempts,
        },
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    mode: "executor_v6_rest_failover",
    image: finalImage.image,
    model: `${finalImage.provider}-${finalImage.actualModel}`,
    provider: finalImage.provider,
    attempts,
    audit: lastAudit,
    learning,
    acceptanceContract: {
      requestHash: contract.requestHash,
      thresholds: contract.thresholds,
      maxAttempts: contract.maxAttempts,
    },
  });
}
