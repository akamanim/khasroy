import assert from "node:assert/strict";
import { qrMatrix, qrSvg } from "../lib/qr.ts";

// Decoding was verified with OpenCV's QR decoder for versions 1–10 while writing the encoder;
// these checks pin the structure so regressions show up in CI without a decoder.
const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
for (const [text, size] of [["hi", 21], ["https://khasroy.vercel.app/i/j2d4tvbreb", 29], ["x".repeat(213), 57]]) {
  const m = qrMatrix(text).map((row) => row.map((v) => (v ? "1" : "0")).join(""));
  assert.equal(m.length, size, `size for ${text.length} bytes`);
  for (let i = 0; i < 7; i += 1) {
    assert.equal(m[i].slice(0, 7), finder[i], "top-left finder");
    assert.equal(m[i].slice(size - 7), finder[i], "top-right finder");
    assert.equal(m[size - 7 + i].slice(0, 7), finder[i], "bottom-left finder");
  }
  assert.equal(m[size - 8][8], "1", "dark module");
}
assert.throws(() => qrMatrix("y".repeat(214)), /too long/u);
assert.match(qrSvg("hi"), /^<svg[^>]+viewBox="0 0 29 29"/u);
console.log("qr: ok");
