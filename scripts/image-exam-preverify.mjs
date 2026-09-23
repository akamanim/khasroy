import { validateGeneratedImage } from "./validate-generated-image.mjs";

export function validateImageExamArtifact(image, { minBytes = 24 } = {}) {
  const bytes = Buffer.isBuffer(image?.bytes) ? image.bytes : null;
  const mediaType = typeof image?.mediaType === "string" ? image.mediaType : "";
  if (!bytes) throw new Error("image_exam_integrity:bytes_missing");

  const result = validateGeneratedImage({
    base64: bytes.toString("base64"),
    mediaType,
    minBytes,
  });

  if (!result.ok) {
    throw new Error(`image_exam_integrity:${result.reasons.join(",")}`);
  }

  return result;
}
