import { createHash } from "node:crypto";

const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff,0xd8,0xff]);
const WEBP_RIFF = Buffer.from("RIFF", "ascii");
const WEBP_TAG = Buffer.from("WEBP", "ascii");
const JPEG_SOF = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);

function normalizeMediaType(value = "") {
  return String(value).toLowerCase().split(";")[0].trim();
}

function detectJpeg(bytes) {
  if (bytes.length < 4 || !bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_SOF.has(marker)) {
      if (length < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { format: "jpeg", mediaType: "image/jpeg", width, height } : null;
    }
    if (marker === 0xda) return null;
    offset += length;
  }
  return null;
}

function detectFormat(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { format: "png", mediaType: "image/png", width, height } : null;
  }

  const jpeg = detectJpeg(bytes);
  if (jpeg) return jpeg;

  if (
    bytes.length >= 16 &&
    bytes.subarray(0, 4).equals(WEBP_RIFF) &&
    bytes.subarray(8, 12).equals(WEBP_TAG)
  ) {
    return { format: "webp", mediaType: "image/webp", width: null, height: null };
  }

  return null;
}

export function validateGeneratedImage({ base64, mediaType, minBytes = 24 }) {
  const reasons = [];
  const encoded = typeof base64 === "string" ? base64.trim() : "";
  if (!encoded) {
    return { ok: false, reasons: ["base64_missing"], byteLength: 0, sha256: null, detected: null };
  }

  let bytes;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    return { ok: false, reasons: ["base64_invalid"], byteLength: 0, sha256: null, detected: null };
  }

  if (!bytes.length || bytes.toString("base64").replace(/=+$/u, "") !== encoded.replace(/\s+/gu, "").replace(/=+$/u, "")) {
    reasons.push("base64_invalid");
  }
  if (bytes.length < minBytes) reasons.push("image_too_small");

  const detected = detectFormat(bytes);
  if (!detected) reasons.push("image_signature_unknown");

  const claimed = normalizeMediaType(mediaType);
  if (!claimed.startsWith("image/")) reasons.push("media_type_not_image");
  if (detected && claimed && claimed !== detected.mediaType) reasons.push("media_type_mismatch");

  return {
    ok: reasons.length === 0,
    reasons,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    detected,
  };
}
