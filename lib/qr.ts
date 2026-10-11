// Small QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–10
// (up to 213 bytes — plenty for an invitation link). Returns the module matrix; qrSvg() draws it.
// Written in-house to avoid a dependency; verified against a decoder in tests/qr.mjs.

type Version = { total: number; ec: number; groups: Array<[number, number]> };

// Codeword layout for level M: total codewords, EC codewords per block, [blocks, data per block].
const VERSIONS: Record<number, Version> = {
  1: { total: 26, ec: 10, groups: [[1, 16]] },
  2: { total: 44, ec: 16, groups: [[1, 28]] },
  3: { total: 70, ec: 26, groups: [[1, 44]] },
  4: { total: 100, ec: 18, groups: [[2, 32]] },
  5: { total: 134, ec: 24, groups: [[2, 43]] },
  6: { total: 172, ec: 16, groups: [[4, 27]] },
  7: { total: 196, ec: 18, groups: [[4, 31]] },
  8: { total: 242, ec: 22, groups: [[2, 38], [2, 39]] },
  9: { total: 292, ec: 22, groups: [[3, 36], [2, 37]] },
  10: { total: 346, ec: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// GF(256) arithmetic with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecc(data: number[], degree: number): number[] {
  const gen = generator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i += 1) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

function bch(value: number, poly: number, bits: number): number {
  let v = value << bits;
  const top = 31 - Math.clz32(poly);
  while (v && 31 - Math.clz32(v) >= top) v ^= poly << (31 - Math.clz32(v) - top);
  return (value << bits) | v;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const capacity = VERSIONS[v].groups.reduce((n, [b, d]) => n + b * d, 0);
    const bits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= capacity * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("text too long for a QR code");
  const spec = VERSIONS[version];
  const dataCount = spec.groups.reduce((n, [b, d]) => n + b * d, 0);

  // Bit stream: mode 0100 (byte), length, data, terminator, padding.
  const bitList: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bitList.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCount * 8 - bitList.length));
  while (bitList.length % 8) bitList.push(0);
  const data: number[] = [];
  for (let i = 0; i < bitList.length; i += 8) data.push(parseInt(bitList.slice(i, i + 8).join(""), 2));
  for (let pad = 0; data.length < dataCount; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);

  // Split into blocks, add error correction, interleave.
  const blocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      blocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const eccBlocks = blocks.map((b) => ecc(b, spec.ec));
  const codewords: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) for (const b of blocks) if (i < b.length) codewords.push(b[i]);
  for (let i = 0; i < spec.ec; i += 1) for (const b of eccBlocks) codewords.push(b[i]);

  const size = version * 4 + 17;
  const grid: Array<Array<boolean | null>> = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, v: boolean) => {
    grid[r][c] = v;
    reserved[r][c] = true;
  };

  // Finder patterns with separators.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, inRing || inCore);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns.
  const centres = ALIGN[version];
  const last = centres[centres.length - 1];
  for (const r of centres) {
    for (const c of centres) {
      // Skip only the three corners that overlap finder patterns; the others may cross timing lines.
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }
  // Dark module and reserved format/version areas.
  set(size - 8, 8, true);
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  if (version >= 7) {
    const info = bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((info >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Data placement in the zigzag order.
  const dataBits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i -= 1) dataBits.push((cw >>> i) & 1);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k += 1) {
      const r = upward ? size - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (reserved[r][c]) continue;
        grid[r][c] = (dataBits[bitIndex] ?? 0) === 1;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  const masks: Array<(r: number, c: number) => boolean> = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function withMask(m: number): boolean[][] {
    const out = grid.map((row, r) => row.map((v, c) => (reserved[r][c] ? Boolean(v) : Boolean(v) !== masks[m](r, c))));
    // Format information: level M (00) + mask, BCH(15,5), XOR 0x5412.
    const format = bch((0b00 << 3) | m, 0x537, 10) ^ 0x5412;
    const bit = (i: number) => ((format >>> i) & 1) === 1;
    // First copy around the top-left finder (skipping the timing row/column 6).
    for (let i = 0; i <= 5; i += 1) out[i][8] = bit(i);
    out[7][8] = bit(6);
    out[8][8] = bit(7);
    out[8][7] = bit(8);
    for (let i = 9; i < 15; i += 1) out[8][14 - i] = bit(i);
    // Second copy split between the top-right and bottom-left finders.
    for (let i = 0; i < 8; i += 1) out[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i += 1) out[size - 15 + i][8] = bit(i);
    out[size - 8][8] = true;
    return out;
  }

  function penalty(m: boolean[][]): number {
    let score = 0;
    const n = m.length;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < n; i += 1) {
        let run = 1;
        for (let j = 1; j < n; j += 1) {
          const a = pass ? m[j][i] : m[i][j];
          const b = pass ? m[j - 1][i] : m[i][j - 1];
          if (a === b) run += 1;
          else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
        if (run >= 5) score += run - 2;
      }
    }
    for (let r = 0; r < n - 1; r += 1) {
      for (let c = 0; c < n - 1; c += 1) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
    score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }

  let best = withMask(0);
  let bestScore = penalty(best);
  for (let m = 1; m < 8; m += 1) {
    const candidate = withMask(m);
    const s = penalty(candidate);
    if (s < bestScore) {
      best = candidate;
      bestScore = s;
    }
  }
  return best;
}

/** SVG markup for a QR code with a 4-module quiet zone. */
export function qrSvg(text: string, { dark = "#111", light = "#fff", size = 512 } = {}): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let path = "";
  m.forEach((row, r) => row.forEach((on, c) => {
    if (on) path += `M${c + 4} ${r + 4}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
