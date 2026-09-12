import { upsertSkill } from "@/lib/server-memory";
import type { ImageSemanticAudit } from "@/lib/server-image-verifier";

const LEARNING_ENDPOINT =
  process.env.KHASROY_LEARNING_ENDPOINT ||
  "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-learning";

const LEARNING_API_KEY =
  process.env.KHASROY_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_cQzfru6dR7_T4myYO1c_fA_r-iFXOtn";

export type LearningStats = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
  eligible: boolean;
};

export type LearningArtifact = {
  id: string;
  skill_slug: string;
  version: number;
  artifact_type: string;
  status: "candidate" | "verified" | "rejected" | string;
  source_type?: string;
  checksum?: string;
  metrics?: Record<string, unknown>;
};

type LearningEnvelope<T> = T & {
  ok?: boolean;
  error?: string;
};

async function learningCall<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(LEARNING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LEARNING_API_KEY,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  const payload = (await response.json().catch(() => null)) as
    | LearningEnvelope<T>
    | null;

  if (!response.ok || !payload) {
    throw new Error(
      `Learning Core failed (${response.status}): ${payload?.error || "empty_response"}`,
    );
  }

  return payload as T;
}

export async function listLearningArtifacts(
  ownerKey: string,
  options: { skillSlug?: string; status?: string; limit?: number } = {},
): Promise<LearningArtifact[]> {
  return learningCall<LearningArtifact[]>({
    action: "list_artifacts",
    ownerKey,
    skillSlug: options.skillSlug || "",
    status: options.status || "",
    limit: options.limit || 30,
  });
}

async function createImageCandidate(ownerKey: string) {
  const created = await learningCall<{ artifact?: LearningArtifact | null }>({
    action: "create_candidate",
    ownerKey,
    skillSlug: "chat_image_generation",
    artifactType: "procedure",
    sourceType: "self",
    sourceRef: "khasroy-image-semantic-learning-loop-v2",
    content: [
      "SKILL: Generate, verify, repair and deliver an image directly in Khasroy chat.",
      "1. Detect an image-generation or visual-scene request and route it to Image Lab.",
      "2. Compile the owner's short request into explicit subject, environment and anti-substitution constraints.",
      "3. Generate a real image using an available image provider.",
      "4. Use an independent vision model to compare visible content with the owner's original request.",
      "5. A real image media type alone is NOT success.",
      "6. If subject/scene verification fails, save the mismatch as a learning lesson, strengthen the prompt and retry once.",
      "7. Do not show a final image that still fails semantic verification.",
      "8. One owner request counts as one practical trial, regardless of internal retries.",
      "9. Promote only after repeated semantically verified real chat generations.",
    ].join("\n"),
  });

  if (!created.artifact?.id) {
    throw new Error("Learning Core did not create image-generation candidate");
  }
  return created.artifact;
}

export async function ensureChatImageGenerationCandidate(ownerKey: string) {
  const verified = await listLearningArtifacts(ownerKey, {
    skillSlug: "chat_image_generation",
    status: "verified",
    limit: 1,
  });
  if (verified[0]?.version >= 2) {
    return { artifact: verified[0], status: "verified" as const };
  }

  const candidates = await listLearningArtifacts(ownerKey, {
    skillSlug: "chat_image_generation",
    status: "candidate",
    limit: 5,
  });
  const current = candidates.find((artifact) => artifact.version >= 2) || null;
  const artifact = current || (await createImageCandidate(ownerKey));

  await upsertSkill(ownerKey, {
    slug: "chat_image_generation",
    name: "Генерация изображений прямо в чате",
    description:
      "Хасрой распознаёт визуальный запрос, генерирует изображение, самостоятельно сверяет видимый результат с заданием, исправляет провал и только после проверки возвращает картинку владельцу.",
    status: "learning",
    level: 2,
    testsPassed: 0,
    testsFailed: 0,
    metadata: {
      learningCore: true,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      stage: "semantic_practical_verification",
      verification: "independent_vision_required",
    },
  });

  return { artifact, status: "learning" as const };
}

export async function recordChatImageGenerationTrial(
  ownerKey: string,
  args: {
    prompt: string;
    model: string;
    mediaType: string;
    mode: string;
    runtimeMs: number;
    attempts: number;
    audit: ImageSemanticAudit;
  },
) {
  const current = await ensureChatImageGenerationCandidate(ownerKey);
  const validMedia = /^image\/(?:png|jpeg|jpg|webp)$/iu.test(args.mediaType);
  const passed = validMedia && args.audit.passed;
  const score = passed ? args.audit.score : Math.min(args.audit.score, 0.69);

  const trial = await learningCall<{ artifactId: string; stats: LearningStats }>({
    action: "record_trial",
    ownerKey,
    artifactId: current.artifact.id,
    testName: `semantic_chat_image_${Date.now()}`,
    input: {
      prompt: args.prompt.slice(0, 1200),
      mode: args.mode,
    },
    result: {
      model: args.model,
      mediaType: args.mediaType,
      deliveredToChat: passed,
      attempts: args.attempts,
      verifierModel: args.audit.model,
      subjectMatch: args.audit.subjectMatch,
      sceneMatch: args.audit.sceneMatch,
      requestMatch: args.audit.requestMatch,
      overall: args.audit.overall,
      criticalMismatch: args.audit.criticalMismatch,
      mismatches: args.audit.mismatches,
      visibleFacts: args.audit.visibleFacts,
    },
    passed,
    score,
    runtimeMs: args.runtimeMs,
    evidence: [
      `Image runtime returned ${args.mediaType} using ${args.model}; mode=${args.mode}; attempts=${args.attempts}.`,
      `Independent vision: subject=${args.audit.subjectMatch}, scene=${args.audit.sceneMatch}, request=${args.audit.requestMatch}, overall=${args.audit.overall}, criticalMismatch=${args.audit.criticalMismatch}.`,
      args.audit.mismatches.length ? `Mismatches: ${args.audit.mismatches.join("; ").slice(0, 900)}` : "No critical mismatch reported.",
    ].join(" "),
  });

  let status: "learning" | "verified" = current.status === "verified" ? "verified" : "learning";
  if (status === "learning" && trial.stats?.eligible) {
    try {
      await learningCall({
        action: "promote_artifact",
        ownerKey,
        artifactId: current.artifact.id,
      });
      status = "verified";
    } catch (error) {
      console.error("Khasroy Learning Core promotion failed", error);
    }
  }

  if (status === "learning") {
    await upsertSkill(ownerKey, {
      slug: "chat_image_generation",
      name: "Генерация изображений прямо в чате",
      description:
        "Хасрой генерирует, визуально проверяет и при необходимости исправляет изображение перед показом владельцу. Навык проходит реальные семантические экзамены.",
      status: "learning",
      level: 2,
      testsPassed: trial.stats?.passed || 0,
      testsFailed: trial.stats?.failed || 0,
      metadata: {
        learningCore: true,
        artifactId: current.artifact.id,
        artifactVersion: current.artifact.version,
        verification: trial.stats,
        lastAudit: {
          passed,
          subjectMatch: args.audit.subjectMatch,
          sceneMatch: args.audit.sceneMatch,
          requestMatch: args.audit.requestMatch,
          overall: args.audit.overall,
          criticalMismatch: args.audit.criticalMismatch,
          attempts: args.attempts,
        },
      },
    });
  }

  return {
    skill: "chat_image_generation",
    status,
    artifactId: current.artifact.id,
    artifactVersion: current.artifact.version,
    stats: trial.stats,
    passed,
  };
}
