import assert from 'node:assert/strict';
import { requireValidImageBeforeVisualExam } from '../scripts/image-exam-preverify-gate.mjs';

const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZpNsAAAAASUVORK5CYII=', 'base64');

const valid = requireValidImageBeforeVisualExam({ bytes: png1x1, mediaType: 'image/png' }, { minBytes: 24 });
assert.equal(valid.detected.format, 'png');

for (const bad of [
  { bytes: Buffer.from('<html>gateway error</html>'), mediaType: 'image/png', minBytes: 8, reason: 'image_signature_unknown' },
  { bytes: png1x1, mediaType: 'image/jpeg', minBytes: 24, reason: 'media_type_mismatch' },
  { bytes: png1x1, mediaType: 'image/png', minBytes: 1024, reason: 'image_too_small' },
]) {
  assert.throws(
    () => requireValidImageBeforeVisualExam({ bytes: bad.bytes, mediaType: bad.mediaType }, { minBytes: bad.minBytes }),
    (error) => error?.code === 'IMAGE_EXAM_ARTIFACT_REJECTED' && error?.evidence?.reasons?.includes(bad.reason),
  );
}

console.log(JSON.stringify({ ok: true, passed: 4, failed: 0, contract: 'invalid artifacts cannot reach visual examiner' }));
