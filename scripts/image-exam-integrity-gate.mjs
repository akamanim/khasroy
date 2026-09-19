import { validateGeneratedImage } from './validate-generated-image.mjs';

/**
 * Fail-closed bridge for image-exam-direct.
 * Accepts the generator's in-memory artifact shape and reuses the existing
 * Vision School binary validator before any paid/AI visual examiner call.
 */
export function validateExamImageArtifact(image, { minBytes = 24 } = {}) {
  if (!image || !Buffer.isBuffer(image.bytes)) {
    return { ok: false, reasons: ['image_bytes_missing'], byteLength: 0, sha256: null, detected: null };
  }

  return validateGeneratedImage({
    base64: image.bytes.toString('base64'),
    mediaType: image.mediaType,
    minBytes,
  });
}

export function assertExamImageArtifact(image, options) {
  const result = validateExamImageArtifact(image, options);
  if (!result.ok) {
    throw new Error(`image_integrity_gate_failed:${result.reasons.join(',')}`);
  }
  return result;
}
