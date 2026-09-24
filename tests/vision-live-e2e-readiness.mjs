import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/image-exam-direct.mjs", import.meta.url), "utf8");
const hasValidatorImport = source.includes("validateGeneratedImage");
const verifyCall = source.indexOf("const audit = await verifyImage(token, image)");
const validationCall = source.indexOf("validateGeneratedImage({");
const integrityBeforeVision = validationCall >= 0 && verifyCall >= 0 && validationCall < verifyCall;

const readiness = {
  liveExamScriptPresent: source.length > 0,
  hasValidatorImport,
  integrityBeforeVision,
  readyForLiveE2E: hasValidatorImport && integrityBeforeVision,
  blockers: [],
};

if (!hasValidatorImport) readiness.blockers.push("image-exam-direct does not import the generated-image integrity validator");
if (!integrityBeforeVision) readiness.blockers.push("generated artifact is not integrity-checked before verifyImage");

assert.equal(readiness.liveExamScriptPresent, true);
assert.equal(readiness.readyForLiveE2E, false);
assert.equal(readiness.blockers.length, 2);

console.log(JSON.stringify({ ok: true, diagnostic: "vision_live_e2e_readiness", readiness }, null, 2));
