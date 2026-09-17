import { validateImageExamArtifact } from './image-exam-artifact-gate.mjs';

export function requireValidImageBeforeVisualExam(image, options = {}) {
  const gate = validateImageExamArtifact({
    bytes: image?.bytes,
    mediaType: image?.mediaType,
    minBytes: options.minBytes ?? 1024,
  });
  if (!gate.accepted) {
    const error = new Error(`image_exam_artifact_rejected:${gate.integrity.reasons.join(',')}`);
    error.code = 'IMAGE_EXAM_ARTIFACT_REJECTED';
    error.evidence = gate.integrity;
    throw error;
  }
  return gate.integrity;
}
