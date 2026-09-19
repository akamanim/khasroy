import assert from 'node:assert/strict';
import { validateExamImageArtifact, assertExamImageArtifact } from '../scripts/image-exam-integrity-gate.mjs';

function png(width = 2, height = 3) {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const valid = validateExamImageArtifact({ bytes: png(), mediaType: 'image/png' });
assert.equal(valid.ok, true);
assert.equal(valid.detected?.width, 2);
assert.equal(valid.detected?.height, 3);
assert.match(valid.sha256 || '', /^[a-f0-9]{64}$/);

const html = validateExamImageArtifact({ bytes: Buffer.from('<html>not an image</html>'), mediaType: 'image/png' });
assert.equal(html.ok, false);
assert.ok(html.reasons.includes('image_signature_unknown'));

const mismatch = validateExamImageArtifact({ bytes: png(), mediaType: 'image/jpeg' });
assert.equal(mismatch.ok, false);
assert.ok(mismatch.reasons.includes('media_type_mismatch'));

assert.throws(
  () => assertExamImageArtifact({ bytes: Buffer.from('bad'), mediaType: 'image/png' }),
  /image_integrity_gate_failed/,
);

console.log('image-exam-integrity-gate: 4/4 passed');
