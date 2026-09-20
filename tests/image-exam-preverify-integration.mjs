import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateImageExamArtifact } from "../scripts/image-exam-preverify.mjs";

const png = Buffer.alloc(24);
Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png, 0);
png.writeUInt32BE(1, 16);
png.writeUInt32BE(1, 20);
const good = validateImageExamArtifact({ bytes: png, mediaType: "image/png" });
assert.equal(good.ok, true);
assert.equal(good.detected.width, 1);
assert.equal(good.detected.height, 1);
assert.equal(good.sha256.length, 64);

assert.throws(
  () => validateImageExamArtifact({ bytes: Buffer.from("<html>gateway error</html>"), mediaType: "image/png" }),
  /image_exam_integrity:/,
);
assert.throws(
  () => validateImageExamArtifact({ bytes: png, mediaType: "text/html" }),
  /media_type_not_image|media_type_mismatch/,
);
assert.throws(
  () => validateImageExamArtifact({ mediaType: "image/png" }),
  /bytes_missing/,
);

const examSource = await readFile(new URL("../scripts/image-exam-direct.mjs", import.meta.url), "utf8");
assert.match(examSource, /const integrity=validateImageExamArtifact\(image\)/);
assert.match(examSource, /const audit=await verifyImage\(token,image\)/);
assert.ok(
  examSource.indexOf("validateImageExamArtifact(image)") < examSource.indexOf("verifyImage(token,image)"),
  "integrity gate must execute before visual verifier",
);

console.log("image-exam-preverify-integration: 5/5 ok");
