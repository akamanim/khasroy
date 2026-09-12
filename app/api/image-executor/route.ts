import { createHash } from "node:crypto";
import { generateImage } from "ai";
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
const MIN_RETRY_BUDGET_MS = 12_000;
const GATEWAY_GENERATION_TIMEOUT_MS = 26_000;
const GATEWAY_REPAIR_TIMEOUT_MS = 24_000;
const POLLINATIONS_GENERATION_TIMEOUT_MS = 18_000;
const GATEWAY_GENERATION_MODEL =
  process.env.KHASROY_IMAGE_GENERATION_MODEL || "openai/gpt-image-2.5-flare";
const GATEWAY_REPAIR_MODEL =
  process.env.KHASROY_IMAGE_REPAIR_MODEL || "openai/gpt-image-2.5-sunburst";
const GATEWAY_GENERATION_FALLBACKS = [
  "openai/gpt-image-1.5",
  "spacexai/grok-imagine-image-2.0",
];
const GATEWAY_REPAIR_FALLBACKS = [
  "spacexai/grok-imagine-image-2.0",
  "openai/gpt-image-1.5",
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
  provider: "vercel-ai-gateway" | "pollinations";
  requestedModel: string;
  actualModel: string;
};

type TechnicalFailure = {
  code: string;
  stage: "generation" | "verification" | "budget";
  detail: string;
  retryable: boolean;
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
  if (/429|rate.?limit|quota|cooling.?down/u.test(lower)) code = `${stage}_rate_limited`;
  else if (/timeout|abort/u.test(lower)) code = `${stage}_timeout`;
  else if (/401|403|unauthor|forbidden/u.test(lower)) {
    code = `${stage}_configuration_error`;
    retryable = false;
  }
  return { code, stage, detail: message.slice(0, 480), retryable };
}

function compactProviderPrompt(prompt: string, maxChars = 1500) {
  return prompt.replace(/\s+/gu, " ").trim().slice(0, maxChars);
}

function imageBytes(imageDataUrl: string) {
  const comma = imageDataUrl.indexOf(",");
  if (comma < 0) throw new Error("repair_source_invalid_data_url");
  return new Uint8Array(Buffer.from(imageDataUrl.slice(comma + 1), "base64"));
}

async function generateGatewayImage(prompt: string, timeoutMs: number): Promise<GeneratedImage> {
  const compact = compactProviderPrompt(prompt, 1500);
  if (!compact) throw new Error("gateway_prompt_empty");

  const result = await generateImage({
    model: GATEWAY_GENERATION_MODEL,
    prompt: compact,
    aspectRatio: "1:1",
    n: 1,
    maxRetries: 0,
    providerOptions: {
      gateway: {
        models: GATEWAY_GENERATION_FALLBACKS,
        tags: ["feature:image-exam-generation"],
      },
    },
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  if (!result.image?.base64) {
    throw new Error(`gateway_model_${GATEWAY_GENERATION_MODEL}_returned_no_image`);
  }
  const mediaType = result.image.mediaType || "image/png";
  return {
    image: `data:${mediaType};base64,${result.image.base64}`,
    mediaType,
    provider: "vercel-ai-gateway",
    requestedModel: GATEWAY_GENERATION_MODEL,
    actualModel: "gateway-routed-generation",
  };
}

async function repairGatewayImage(args: {
  source: GeneratedImage;
  originalPrompt: string;
  repairPrompt: string;
  timeoutMs: number;
}): Promise<GeneratedImage> {
  const text = [
    "EDIT THE PROVIDED IMAGE TO PASS A STRICT VISUAL EXAM.",
    `Original owner request: ${compactProviderPrompt(args.originalPrompt, 900)}`,
    `Mandatory audited correction: ${compactProviderPrompt(args.repairPrompt, 500)}`,
    "Preserve useful matching details from the provided image, but correct wrong subject identity, wrong vehicle make/model, wrong environment, composition and visible geometry when required by the audit.",
    "Do not add unrelated rooms, people, objects, logos, text or watermarks unless explicitly requested.",
  ].join("\n");

  const result = await generateImage({
    model: GATEWAY_REPAIR_MODEL,
    prompt: { text, images: [imageBytes(args.source.image)] },
    aspectRatio: "1:1",
    n: 1,
    maxRetries: 0,
    providerOptions: {
      gateway: {
        models: GATEWAY_REPAIR_FALLBACKS,
        tags: ["feature:image-exam-repair"],
      },
    },
    abortSignal: AbortSignal.timeout(args.timeoutMs),
  });

  if (!result.image?.base64) {
    throw new Error(`gateway_repair_${GATEWAY_REPAIR_MODEL}_returned_no_image`);
  }
  const mediaType = result.image.mediaType || "image/png";
  return {
    image: `data:${mediaType};base64,${result.image.base64}`,
    mediaType,
    provider: "vercel-ai-gateway",
    requestedModel: GATEWAY_REPAIR_MODEL,
    actualModel: "gateway-routed-reference-repair",
  };
}

async function fetchPollinationsImage(args: {
  prompt: string;
  timeoutMs: number;
}): Promise<GeneratedImage> {
  const compact = compactProviderPrompt(args.prompt, 620);
  const encoded = encodeURIComponent(compact);
  if (!compact || encoded.length > 1800) {
    throw new Error("provider_prompt_path_too_long");
  }

  const seed = Date.now() % 2147483647;
  const requestedModel = "flux";
  const url = `https://image.pollinations.ai/prompt/${encoded}?model=${requestedModel}&width=1024&height=1024&nologo=true&seed=${seed}`;
  const response = await fetch(url, {
    headers: { "user-agent": "Khasroy-Image-Executor/5.0" },
    signal: AbortSignal.timeout(args.timeoutMs),
    cache: "no-store",
  });
  const mediaType = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (!response.ok || !/^image\/(?:png|jpeg|jpg|webp)$/iu.test(mediaType)) {
    const text = await response.text().catch(() => "");
    throw new Error(`pollinations_${response.status}: ${text.slice(0, 220)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualModel = response.headers.get("x-model-used")?.trim() || "auto";
  return {
    image: `data:${mediaType};base64,${bytes.toString("base64")}`,
    mediaType,
    provider: "pollinations",
    requestedModel,
    actualModel,
  };
}

async function generateWithProviders(args: {
  prompt: string;
  pollinationsPrompt: string;
  availableMs: number;
}): Promise<GeneratedImage> {
  const startedAt = Date.now();
  const gatewayBudget = Math.max(
    8_000,
    Math.min(GATEWAY_GENERATION_TIMEOUT_MS, args.availableMs - 12_000),
  );
  let gatewayError: unknown = null;

  try {
    return await generateGatewayImage(args.prompt, gatewayBudget);
  } catch (error) {
    gatewayError = error;
  }

  const remaining = args.availableMs - (Date.now() - startedAt);
  if (remaining < 6_000) throw gatewayError;

  try {
    return await fetchPollinationsImage({
      prompt: args.pollinationsPrompt,
      timeoutMs: Math.max(6_000, Math.min(POLLINATIONS_GENERATION_TIMEOUT_MS, remaining)),
    });
  } catch (pollinationsError) {
    const first = gatewayError instanceof Error ? gatewayError.message : String(gatewayError);
    const second =
      pollinationsError instanceof Error ? pollinationsError.message : String(pollinationsError);
    throw new Error(
      `gateway_generation_failed=${first.slice(0, 210)}; pollinations_generation_failed=${second.slice(0, 210)}`,
    );
  }
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
    if (attempt > 1 && remaining < MIN_RETRY_BUDGET_MS) {
      repairInterrupted = {
        code: "retry_skipped_time_budget",
        stage: "budget",
        detail: `remaining_compute_budget_ms=${Math.max(0, remaining)}`,
        retryable: true,
      };
      break;
    }

    attempts = attempt;
    let image: GeneratedImage;

    if (attempt > 1 && finalImage && repairPrompt) {
      try {
        image = await repairGatewayImage({
          source: finalImage,
          originalPrompt: contract.prompt,
          repairPrompt,
          timeoutMs: Math.max(8_000, Math.min(GATEWAY_REPAIR_TIMEOUT_MS, remaining - 7_000)),
        });
      } catch (error) {
        repairInterrupted = technicalFailure("generation", error);
        await rememberTechnicalInterruption(
          ownerKey,
          contract,
          repairInterrupted,
          attempt,
          audits[audits.length - 1] || null,
        );
        break;
      }
    } else {
      const compiledPrompt = compileImagePrompt(contract.prompt, { lessons });
      try {
        const available = Math.max(8_000, deadline - Date.now() - 9_000);
        image = await generateWithProviders({
          prompt: compiledPrompt,
          pollinationsPrompt: contract.prompt,
          availableMs: available,
        });
      } catch (error) {
        techFailure = technicalFailure("generation", error);
        break;
      }
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
        error:
          techFailure.stage === "budget"
            ? "Я остановил внутренний retry, чтобы не упереться в лимит выполнения. Уже найденная ошибка сохранена как учебный материал, но экзамен не засчитан ни в плюс, ни в минус."
            : "Технический ресурс прервал генерацию или проверку. Это не считается провалом навыка; экзамен остаётся незавершённым.",
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
    mode: "executor_v5_reference_repair",
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
          ? "Первая картинка была реально создана и проверена, но не прошла визуальный экзамен. Автоматический repair-проход был временно недоступен; провал уже записан в обучение, а не потерян как незавершённый экзамен."
          : "Я закончил разрешённые попытки, но финальная картинка не прошла заранее заданный визуальный экзамен. Плохой результат скрыт, провал записан в обучение.",
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
    mode: "executor_v5_reference_repair",
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
