import assert from "node:assert/strict";
import { validateGeneratedImage } from "../scripts/validate-generated-image.mjs";

const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZpNsAAAAASUVORK5CYII=";

const good = validateGeneratedImage({ base64: png1x1, mediaType: "image/png", minBytes: 24 });
assert.equal(good.ok, true);
assert.equal(good.detected?.format, "png");
assert.equal(good.detected?.width, 1);
assert.equal(good.detected?.height, 1);
assert.equal(good.byteLength > 24, true);
assert.match(good.sha256 || "", /^[a-f0-9]{64}$/u);

const mismatch = validateGeneratedImage({ base64: png1x1, mediaType: "image/jpeg", minBytes: 24 });
assert.equal(mismatch.ok, false);
assert.deepEqual(mismatch.reasons, ["media_type_mismatch"]);

const nonImage = validateGeneratedImage({ base64: Buffer.from("not-an-image-payload").toString("base64"), mediaType: "image/png", minBytes: 8 });
assert.equal(nonImage.ok, false);
assert.ok(nonImage.reasons.includes("image_signature_unknown"));

const missing = validateGeneratedImage({ base64: "", mediaType: "image/png" });
assert.equal(missing.ok, false);
assert.deepEqual(missing.reasons, ["base64_missing"]);

const wrongType = validateGeneratedImage({ base64: png1x1, mediaType: "text/plain", minBytes: 24 });
assert.equal(wrongType.ok, false);
assert.ok(wrongType.reasons.includes("media_type_not_image"));
assert.ok(wrongType.reasons.includes("media_type_mismatch"));

const fakeJpegBytes = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10]), Buffer.alloc(40, 0x41)]);
const fakeJpeg = validateGeneratedImage({ base64: fakeJpegBytes.toString("base64"), mediaType: "image/jpeg", minBytes: 24 });
assert.equal(fakeJpeg.ok, false);
assert.ok(fakeJpeg.reasons.includes("image_signature_unknown"));

const structuredJpegBytes = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x20,0x00,0x30,0x01,0x01,0x11,0x00,0xff,0xd9]);
const structuredJpeg = validateGeneratedImage({ base64: structuredJpegBytes.toString("base64"), mediaType: "image/jpeg", minBytes: 16 });
assert.equal(structuredJpeg.ok, true);
assert.equal(structuredJpeg.detected?.format, "jpeg");
assert.equal(structuredJpeg.detected?.width, 48);
assert.equal(structuredJpeg.detected?.height, 32);

console.log(JSON.stringify({
  ok: true,
  passed: 7,
  failed: 0,
  evidence: {
    png: { format: good.detected?.format, dimensions: [good.detected?.width, good.detected?.height] },
    jpeg: { format: structuredJpeg.detected?.format, dimensions: [structuredJpeg.detected?.width, structuredJpeg.detected?.height] },
    rejected: {
      mimeMismatch: mismatch.reasons,
      invalidPayload: nonImage.reasons,
      missingPayload: missing.reasons,
      nonImageMediaType: wrongType.reasons,
      fakeJpegSignatureOnly: fakeJpeg.reasons,
    },
  },
}, null, 2));
