import { upsertSkill } from "@/lib/server-memory";

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

export async function ensureChatImageGenerationCandidate(ownerKey: string) {
  const verified = await listLearningArtifacts(ownerKey, {
    skillSlug: "chat_image_generation",
    status: "verified",
    limit: 1,
  });
  if (verified[0]) {
    return { artifact: verified[0], status: "verified" as const };
  }

  const candidates = await listLearningArtifacts(ownerKey, {
    skillSlug: "chat_image_generation",
    status: "candidate",
    limit: 1,
  });
  if (candidates[0]) {
    await upsertSkill(ownerKey, {
      slug: "chat_image_generation",
      name: "Генерация изображений прямо в чате",
      description:
        "Хасрой распознаёт запрос на создание изображения, вызывает Image Lab, проверяет наличие реального image/* результата и возвращает готовую картинку прямо в диалог.",
      status: "learning",
      level: 1,
      testsPassed: 0,
      testsFailed: 0,
      metadata: {
        learningCore: true,
        artifactId: candidates[0].id,
        stage: "practical_verification",
      },
    });
    return { artifact: candidates[0], status: "learning" as const };
  }

  const created = await learningCall<{ artifact?: LearningArtifact | null }>({
    action: "create_candidate",
    ownerKey,
    skillSlug: "chat_image_generation",
    artifactType: "procedure",
    sourceType: "self",
    sourceRef: "khasroy-image-lab-runtime",
    content: [
      "SKILL: Generate and deliver an image directly in Khasroy chat.",
      "1. Detect an explicit image-generation request.",
      "2. Route it to Khasroy Image Lab instead of answering with a text-only prompt.",
      "3. Require the upstream result to be a real image media type.",
      "4. Convert the image to a safe data:image base64 payload for the authenticated owner chat.",
      "5. Return the generated image in the assistant message.",
      "6. Count only real successful runtime generations as practical trials.",
      "7. Treat visual-quality auditing and repair as a separate advanced skill layer.",
    ].join("\n"),
  });

  if (!created.artifact?.id) {
    throw new Error("Learning Core did not create image-generation candidate");
  }

  await upsertSkill(ownerKey, {
    slug: "chat_image_generation",
    name: "Генерация изображений прямо в чате",
    description:
      "Хасрой распознаёт запрос на создание изображения, вызывает Image Lab и возвращает реальную картинку прямо в диалог. Навык проходит практическую проверку.",
    status: "learning",
    level: 1,
    testsPassed: 0,
    testsFailed: 0,
    metadata: {
      learningCore: true,
      artifactId: created.artifact.id,
      stage: "practical_verification",
    },
  });

  return { artifact: created.artifact, status: "learning" as const };
}

export async function recordChatImageGenerationTrial(
  ownerKey: string,
  args: {
    prompt: string;
    model: string;
    mediaType: string;
    mode: string;
    runtimeMs: number;
  },
) {
  const current = await ensureChatImageGenerationCandidate(ownerKey);
  if (current.status === "verified") {
    return {
      skill: "chat_image_generation",
      status: "verified" as const,
      artifactId: current.artifact.id,
    };
  }

  const trial = await learningCall<{ artifactId: string; stats: LearningStats }>({
    action: "record_trial",
    ownerKey,
    artifactId: current.artifact.id,
    testName: `real_chat_image_${Date.now()}`,
    input: {
      prompt: args.prompt.slice(0, 1200),
      mode: args.mode,
    },
    result: {
      model: args.model,
      mediaType: args.mediaType,
      deliveredToChat: true,
    },
    passed: /^image\/(?:png|jpeg|jpg|webp)$/iu.test(args.mediaType),
    score: /^image\/(?:png|jpeg|jpg|webp)$/iu.test(args.mediaType) ? 1 : 0,
    runtimeMs: args.runtimeMs,
    evidence: `Real Image Lab runtime returned ${args.mediaType} using ${args.model}; mode=${args.mode}.`,
  });

  let status: "learning" | "verified" = "learning";
  if (trial.stats?.eligible) {
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
        "Хасрой создаёт реальное изображение через Image Lab и возвращает его прямо в диалог. Навык проходит практическую проверку.",
      status: "learning",
      level: 1,
      testsPassed: trial.stats?.passed || 0,
      testsFailed: trial.stats?.failed || 0,
      metadata: {
        learningCore: true,
        artifactId: current.artifact.id,
        verification: trial.stats,
      },
    });
  }

  return {
    skill: "chat_image_generation",
    status,
    artifactId: current.artifact.id,
    stats: trial.stats,
  };
}
