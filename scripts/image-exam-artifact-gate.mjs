import { validateGeneratedImage } from './validate-generated-image.mjs';

export function validateImageExamArtifact({ bytes, mediaType, minBytes = 1024 }) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const integrity = validateGeneratedImage({
    base64: buffer.toString('base64'),
    mediaType,
    minBytes,
  });
  return {
    accepted: integrity.ok,
    reason: integrity.ok ? 'artifact_integrity_verified' : `artifact_rejected:${integrity.reasons.join(',')}`,
    integrity,
  };
}
