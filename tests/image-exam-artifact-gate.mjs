import assert from 'node:assert/strict';
import { validateImageExamArtifact } from '../scripts/image-exam-artifact-gate.mjs';

const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZpNsAAAAASUVORK5CYII=', 'base64');

const valid = validateImageExamArtifact({ bytes: png1x1, mediaType: 'image/png', minBytes: 24 });
assert.equal(valid.accepted, true);

const html = validateImageExamArtifact({ bytes: Buffer.from('<html>upstream error</html>'), mediaType: 'image/png', minBytes: 8 });
assert.equal(html.accepted, false);
assert.ok(html.integrity.reasons.includes('image_signature_unknown'));

const mismatch = validateImageExamArtifact({ bytes: png1x1, mediaType: 'image/jpeg', minBytes: 24 });
assert.equal(mismatch.accepted, false);
assert.ok(mismatch.integrity.reasons.includes('media_type_mismatch'));

const tiny = validateImageExamArtifact({ bytes: png1x1, mediaType: 'image/png', minBytes: 1024 });
assert.equal(tiny.accepted, false);
assert.ok(tiny.integrity.reasons.includes('image_too_small'));

console.log(JSON.stringify({
  ok: true,
  passed: 4,
  failed: 0,
  evidence: {
    valid: valid.reason,
    html: html.reason,
    mismatch: mismatch.reason,
    tiny: tiny.reason,
  },
}, null, 2));
