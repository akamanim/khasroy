import { createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { generateImage } from "ai";

const GENERATION_MODEL =
  process.env.KHASROY_IMAGE_GENERATION_MODEL || "openai/gpt-image-2.5-flare";
const REPAIR_MODEL =
  process.env.KHASROY_IMAGE_REPAIR_MODEL || "openai/gpt-image-2.5-sunburst";
const AUDITOR_MODEL =
  process.env.KHASROY_IMAGE_AUDITOR_MODEL || "openai/gpt-5.6-sol";

export type ImageAudit = {
  promptAdherence: number;
  composition: number;
  lighting: number;
  realism: number;
  artifactControl: number;
  overall: number;
  strengths: string[];
  defects: string[];
  repairInstruction: string;
};

export type ImageLabResult = {
  prompt: string;
  baseline: {
    model: string;
    mediaType: string;
    base64: string;
    sha256: string;
    audit: ImageAudit;
  };
  repaired: {
    model: string;
    mediaType: string;
    base64: string;
    sha256: string;
    audit: ImageAudit;
  } | null;
  delta: number;
  improved: boolean;
};

function clampScore(value: unknown) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function textList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 8)
    : [];
}

function imageHash(base64: string) {
  return createHash("sha256").update(base64).digest("hex");
}

async function gatewayToken() {
  const configured = process.env.AI_GATEWAY_API_KEY?.trim();
  if (configured) return configured;
  return getVercelOidcToken({ expirationBufferMs: 2 * 60_000 });
}

async function auditImage(args: {
  prompt: string;
  base64: string;
  mediaType: string;
}): Promise<ImageAudit> {
  const token = await gatewayToken();
  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AUDITOR_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Ты строгий Visual Auditor Khasroy Image Lab. Оцени изображение только по видимому результату и исходному техническому заданию. Не завышай баллы. Дефекты должны быть конкретными и визуально проверяемыми. repairInstruction должен исправлять только найденные дефекты и явно сохранять удачные элементы.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `ИСХОДНОЕ ТЗ:\n${args.prompt}\n\nОцени по шкале 0-100: promptAdherence, composition, lighting, realism, artifactControl, overall. Верни сильные стороны, конкретные дефекты и минимальную repair-инструкцию.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${args.mediaType};base64,${args.base64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      stream: false,
      reasoning_effort: "low",
      max_completion_tokens: 900,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "khasroy_image_audit",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              promptAdherence: { type: "number" },
              composition: { type: "number" },
              lighting: { type: "number" },
              realism: { type: "number" },
              artifactControl: { type: "number" },
              overall: { type: "number" },
              strengths: { type: "array", items: { type: "string" } },
              defects: { type: "array", items: { type: "string" } },
              repairInstruction: { type: "string" },
            },
            required: [
              "promptAdherence",
              "composition",
              "lighting",
              "realism",
              "artifactControl",
              "overall",
              "strengths",
              "defects",
              "repairInstruction",
            ],
          },
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(28_000),
  });

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  } | null;

  const content = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!response.ok || !content) {
    throw new Error(
      `Image auditor failed (${response.status}): ${data?.error?.message || "empty response"}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Image auditor returned invalid JSON");
  }

  return {
    promptAdherence: clampScore(parsed.promptAdherence),
    composition: clampScore(parsed.composition),
    lighting: clampScore(parsed.lighting),
    realism: clampScore(parsed.realism),
    artifactControl: clampScore(parsed.artifactControl),
    overall: clampScore(parsed.overall),
    strengths: textList(parsed.strengths),
    defects: textList(parsed.defects),
    repairInstruction:
      typeof parsed.repairInstruction === "string"
        ? parsed.repairInstruction.trim().slice(0, 2400)
        : "Preserve all successful elements and correct only visible defects.",
  };
}

async function makeImage(args: {
  model: string;
  prompt: string | { text: string; images: Uint8Array[] };
}) {
  const result = await generateImage({
    model: args.model,
    prompt: args.prompt,
    aspectRatio: "1:1",
    n: 1,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(55_000),
  });

  if (!result.image?.base64) {
    throw new Error(`Image model ${args.model} returned no image`);
  }

  return {
    base64: result.image.base64,
    mediaType: result.image.mediaType || "image/png",
    bytes: result.image.uint8Array,
  };
}

export async function runImageLab(prompt: string): Promise<ImageLabResult> {
  const cleanPrompt = prompt.trim().slice(0, 5000);
  if (!cleanPrompt) throw new Error("Image Lab prompt is empty");

  const first = await makeImage({ model: GENERATION_MODEL, prompt: cleanPrompt });
  const firstAudit = await auditImage({
    prompt: cleanPrompt,
    base64: first.base64,
    mediaType: first.mediaType,
  });

  const repairText = [
    "TARGETED REPAIR OF THE PROVIDED IMAGE.",
    "Preserve the same subject, object identity, camera position, framing, successful lighting choices and all details that already match the brief.",
    `Original brief: ${cleanPrompt}`,
    "Fix only these audited issues:",
    firstAudit.repairInstruction || firstAudit.defects.join("; "),
    "Do not add text, logos, watermarks or unrelated objects unless the original brief explicitly asks for them.",
  ].join("\n");

  const second = await makeImage({
    model: REPAIR_MODEL,
    prompt: { text: repairText, images: [first.bytes] },
  });
  const secondAudit = await auditImage({
    prompt: cleanPrompt,
    base64: second.base64,
    mediaType: second.mediaType,
  });

  const delta = secondAudit.overall - firstAudit.overall;

  return {
    prompt: cleanPrompt,
    baseline: {
      model: GENERATION_MODEL,
      mediaType: first.mediaType,
      base64: first.base64,
      sha256: imageHash(first.base64),
      audit: firstAudit,
    },
    repaired: {
      model: REPAIR_MODEL,
      mediaType: second.mediaType,
      base64: second.base64,
      sha256: imageHash(second.base64),
      audit: secondAudit,
    },
    delta,
    improved: delta > 0,
  };
}
