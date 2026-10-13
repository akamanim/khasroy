// Soundtrack for the studio preview: a browser port of reels/audio.py (same instruments, styles
// and effects, lighter filters). The final MP4 is still mixed by reels/audio.py on GitHub.

export type Cue = { t: number; sfx: string; len?: number };

const SR = 22050;

function rng(seed: number) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(uni() || 1e-9)) * Math.cos(2 * Math.PI * uni());
  return { uni, normal };
}
type Rng = ReturnType<typeof rng>;

const len = (sec: number) => Math.max(1, Math.floor(sec * SR));
const noteHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

function env(n: number, attack: number, decay: number) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.min(1, t / Math.max(attack, 1e-4)) * Math.exp(-Math.max(t - attack, 0) / Math.max(decay, 1e-4));
  }
  return out;
}

/** RBJ biquad, applied twice for the band filter. */
function biquad(x: Float32Array, type: "low" | "high" | "band", hz: number, q = 0.707) {
  const w = (2 * Math.PI * Math.min(hz, SR / 2 - 200)) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === "low") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === "high") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
const lowpass = (x: Float32Array, hz: number) => biquad(x, "low", hz);
const highpass = (x: Float32Array, hz: number) => biquad(x, "high", hz);
const bandpass = (x: Float32Array, lo: number, hi: number) => {
  const c = Math.sqrt(lo * Math.min(hi, SR / 2 - 300));
  return biquad(x, "band", c, c / Math.max(50, Math.min(hi, SR / 2 - 300) - lo));
};

function noise(n: number, r: Rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.normal();
  return out;
}

function add(buf: Float32Array, sound: Float32Array, at: number, gain = 1) {
  const i0 = Math.floor(at * SR);
  for (let k = 0; k < sound.length; k++) {
    const i = i0 + k;
    if (i < 0) continue;
    if (i >= buf.length) break;
    buf[i] += gain * sound[k];
  }
}

/** Sine sweep from a per-sample frequency function. */
function sweep(n: number, f: (t: number) => number) {
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * f(i / SR)) / SR;
    out[i] = Math.sin(phase);
  }
  return out;
}

function mul(a: Float32Array, b: Float32Array, gain = 1) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (b[i] ?? 0) * gain;
  return out;
}

// ---------- instruments ----------
function kick(r: Rng, punch = 1) {
  const n = len(0.45);
  const body = mul(sweep(n, (t) => 45 + 110 * Math.exp(-t * 32)), env(n, 0.001, 0.16));
  const click = mul(noise(n, r), env(n, 0.0005, 0.004), 0.3);
  return body.map((v, i) => Math.tanh((v + click[i]) * 1.6 * punch));
}
function snare(r: Rng) {
  const n = len(0.3);
  const nz = mul(bandpass(noise(n, r), 1200, 9000), env(n, 0.001, 0.07), 0.8);
  const tone = mul(sweep(n, () => 190), env(n, 0.001, 0.05), 0.5);
  return nz.map((v, i) => v + tone[i]);
}
function clap(r: Rng) {
  const n = len(0.25);
  const out = new Float32Array(n);
  [0, 0.011, 0.022].forEach((d, k) => add(out, mul(bandpass(noise(n, r), 900, 6000), env(n, 0.0005, k < 2 ? 0.012 : 0.09)), d));
  return out.map((v) => v * 0.8);
}
function hat(r: Rng, open = false) {
  const n = len(open ? 0.25 : 0.06);
  return mul(highpass(noise(n, r), 7000), env(n, 0.0005, open ? 0.08 : 0.018), 0.5);
}
function bassNote(hz: number, sec: number, glideFrom?: number) {
  const n = len(sec);
  const out = new Float32Array(n);
  const e = env(n, 0.005, sec * 0.9);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = glideFrom ? hz + (glideFrom - hz) * Math.exp(-t * 18) : hz;
    phase += (2 * Math.PI * f) / SR;
    const s = Math.sin(phase);
    out[i] = Math.tanh((s + 0.25 * Math.sin(2 * phase) + 0.1 * Math.sign(s)) * 1.3) * e[i];
  }
  return lowpass(out, 900);
}
function padChord(notes: number[], sec: number) {
  const n = len(sec);
  const out = new Float32Array(n);
  const attack = Math.min(0.35, sec * 0.3);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x = 0;
    for (const m of notes) for (const d of [-0.08, 0, 0.08]) {
      const f = noteHz(m + d);
      x += Math.sin(2 * Math.PI * f * t + d * 7) + 0.3 * Math.sin(4 * Math.PI * f * t);
    }
    out[i] = (x * Math.min(1, t / attack) * Math.min(1, Math.max(0, (sec - t) / 0.25))) / (notes.length * 3);
  }
  return lowpass(out, 2200);
}
function keysChord(notes: number[], sec: number) {
  const n = len(sec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x = 0;
    for (const m of notes) {
      const f = noteHz(m);
      x += (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * 3.01 * f * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.4);
    }
    out[i] = (x * (1 + 0.15 * Math.sin(2 * Math.PI * 4.5 * t))) / notes.length;
  }
  return out;
}

const STYLES: Record<string, { bpm: number; prog: number[][]; pad: "pad" | "keys" }> = {
  pulse: { bpm: 120, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], pad: "pad" },
  bounce: { bpm: 140, prog: [[57, 60, 64], [57, 60, 64], [53, 57, 60], [55, 59, 62]], pad: "pad" },
  chill: { bpm: 92, prog: [[57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 65], [52, 55, 59, 62]], pad: "keys" },
};

function music(duration: number, style: string, bpm: number, seed: number, outroAt?: number) {
  const r = rng(seed);
  const spec = STYLES[style] ?? STYLES.pulse;
  const beat = 60 / bpm;
  const n = len(duration + 1.5);
  const drums = new Float32Array(n), bass = new Float32Array(n), harm = new Float32Array(n);
  const duck = new Float32Array(n).fill(1);
  const k = kick(r, style === "bounce" ? 1.15 : 1);
  const sn = style !== "pulse" ? snare(r) : clap(r);
  const hh = hat(r);
  const end = outroAt ?? duration;
  const totalBeats = Math.ceil(duration / beat) + 1;
  for (let b = 0; b < totalBeats; b++) {
    const t0 = b * beat;
    if (t0 >= duration) break;
    const inBar = b % 4;
    const play = b >= 2 && t0 < end;
    if (play && style === "pulse") {
      add(drums, k, t0, 0.9);
      add(duck, env(len(0.25), 0.002, 0.09), t0, -0.55);
      add(drums, hh, t0 + beat / 2, 0.55);
      if (inBar === 1 || inBar === 3) add(drums, sn, t0, 0.55);
    } else if (play && style === "bounce") {
      if (inBar === 0 || inBar === 2 || (inBar === 3 && r.uni() < 0.5)) {
        add(drums, k, t0 + (inBar === 3 ? 0.5 * beat : 0), 0.95);
        add(duck, env(len(0.3), 0.002, 0.12), t0, -0.6);
      }
      if (inBar === 2) add(drums, sn, t0, 0.7);
      const steps = r.uni() < 0.25 ? 4 : 2;
      for (let s = 0; s < steps; s++) add(drums, hh, t0 + (s * beat) / (s > 1 ? 4 : 2), 0.45);
    } else if (play) {
      if (inBar === 0 || inBar === 2) {
        add(drums, k, t0 + (inBar === 2 ? 0.06 : 0), 0.56);
        add(duck, env(len(0.3), 0.002, 0.15), t0, -0.3);
      }
      if (inBar === 1 || inBar === 3) add(drums, sn, t0, 0.32);
      add(drums, hh, t0 + beat * 0.58, 0.3);
    }
    if (inBar === 0) {
      const chord = spec.prog[Math.floor(b / 4) % spec.prog.length];
      const barLen = Math.min(beat * 4, duration + 1 - t0);
      if (spec.pad === "keys") add(harm, keysChord(chord, barLen), t0, 0.5);
      else add(harm, padChord(chord, barLen), t0, t0 < end ? 0.45 : 0.6);
      const root = noteHz(chord[0] - 24);
      if (t0 < end) {
        if (style === "bounce") {
          add(bass, bassNote(root, beat * 1.5, root * 1.5), t0, 0.9);
          add(bass, bassNote(root, beat), t0 + beat * 2.5, 0.7);
        } else {
          for (let q = 0; q < 4; q++) add(bass, bassNote(root, beat * 0.45), t0 + q * beat + (style === "pulse" ? beat / 2 : 0), 0.55);
        }
      }
    }
  }
  const introLen = len(2 * beat);
  harm.set(lowpass(harm.subarray(0, introLen), 700), 0);
  const out = new Float32Array(len(duration));
  for (let i = 0; i < out.length; i++) out[i] = drums[i] + (bass[i] + harm[i]) * Math.min(1, Math.max(0.25, duck[i]));
  return out;
}

function sfx(name: string, length: number, r: Rng): Float32Array {
  switch (name) {
    case "whoosh": {
      const n = len(Math.max(0.25, length));
      const nz = noise(n, r);
      const out = new Float32Array(n);
      for (let k = 0; k < 6; k++) {
        const center = 600 + (4400 * k) / 5;
        const seg = bandpass(nz, center * 0.7, center * 1.3);
        for (let i = 0; i < n; i++) {
          const t = i / n;
          out[i] += seg[i] * Math.exp(-((t - (0.25 + k * 0.09)) ** 2) / 0.02);
        }
      }
      return out.map((v, i) => v * Math.sin((Math.PI * i) / n) ** 1.5 * 0.5);
    }
    case "impact": {
      const n = len(1.2);
      const boom = mul(sweep(n, (t) => 38 + 90 * Math.exp(-t * 14)), env(n, 0.002, 0.35));
      const crack = mul(highpass(noise(n, r), 2000), env(n, 0.0005, 0.05), 0.6);
      const tail = mul(lowpass(noise(n, r), 900), env(n, 0.01, 0.4), 0.25);
      return boom.map((v, i) => Math.tanh((v + crack[i] + tail[i]) * 1.4));
    }
    case "glitch": {
      const n = len(Math.max(0.2, length));
      const out = new Float32Array(n);
      let pos = 0;
      while (pos < n) {
        const seg = len(0.012 + r.uni() * 0.038);
        const f = [180, 360, 720, 1440, 2880][Math.floor(r.uni() * 5)];
        const amp = (0.2 + r.uni() * 0.4) * (r.uni() < 0.7 ? 1 : 0);
        for (let i = 0; i < seg && pos + i < n; i++) out[pos + i] = Math.sign(Math.sin((2 * Math.PI * f * i) / SR)) * amp;
        pos += seg;
      }
      return lowpass(out, 6000).map((v) => v * 0.5);
    }
    case "pop": {
      const n = len(0.14);
      return mul(sweep(n, (t) => 520 + 700 * (1 - Math.exp(-t * 60))), env(n, 0.001, 0.035), 0.6);
    }
    case "click": {
      const n = len(0.08);
      const a = mul(sweep(n, () => 2200), env(n, 0.0003, 0.008));
      const b = mul(highpass(noise(n, r), 3000), env(n, 0.0003, 0.004));
      return a.map((v, i) => (v + b[i]) * 0.7);
    }
    case "tick": {
      const n = len(0.05);
      return mul(sweep(n, () => 3200), env(n, 0.0002, 0.006), 0.35);
    }
    case "notify": {
      const n = len(0.9);
      const out = mul(sweep(n, () => noteHz(88)), env(n, 0.002, 0.25), 0.35);
      const m = n - len(0.11);
      add(out, mul(sweep(m, () => noteHz(95)), env(m, 0.002, 0.3), 0.35), 0.11);
      return out;
    }
    case "riser": {
      const n = len(Math.max(0.4, length));
      const nz = highpass(noise(n, r), 1500);
      const tone = sweep(n, (t) => 300 + 1500 * ((t * SR) / n) ** 2);
      return nz.map((v, i) => {
        const p = (i / n) ** 2;
        return v * p * 0.35 + tone[i] * p * 0.12;
      });
    }
    case "voice": {
      const n = len(Math.max(0.5, length));
      const out = new Float32Array(n);
      let pos = 0;
      while (pos < n) {
        const syl = len(0.07 + r.uni() * 0.09);
        const gap = len(0.02 + r.uni() * 0.06);
        const f0 = 150 + r.uni() * 80;
        for (let i = 0; i < syl && pos + i < n; i++) {
          let s = 0;
          for (let h = 1; h < 6; h++) s += Math.sin((2 * Math.PI * f0 * h * i) / SR) / h;
          out[pos + i] = s * Math.sin((Math.PI * i) / syl);
        }
        pos += syl + gap;
      }
      return bandpass(out, 300, 2400).map((v) => v * 0.25);
    }
    default:
      return new Float32Array(1);
  }
}

const GAINS: Record<string, number> = { whoosh: 0.55, impact: 0.9, glitch: 0.45, pop: 0.5, click: 0.6, tick: 0.4, notify: 0.6, riser: 0.5, voice: 0.5 };

/** Mono soundtrack samples at 22 050 Hz: music (unless style is "off") plus effects on the cues. */
export function soundtrack(
  duration: number,
  cues: Cue[],
  opts: { style?: string; bpm?: number; seed?: number; outroAt?: number; music?: boolean; track?: Float32Array },
) {
  const style = opts.style && STYLES[opts.style] ? opts.style : "pulse";
  const bpm = opts.bpm || STYLES[style].bpm;
  const seed = opts.seed ?? 1;
  let mix: Float32Array;
  if (opts.track && opts.track.length > SR) {
    // The owner's track (already at 22 050 Hz, from the chosen offset): trimmed, faded out, levelled.
    mix = new Float32Array(len(duration));
    mix.set(opts.track.subarray(0, mix.length));
    let peak = 1e-6;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    const fade = Math.min(mix.length, len(1.2));
    for (let i = 0; i < mix.length; i++) {
      mix[i] = (mix[i] / peak) * 0.6;
      if (i > mix.length - fade) mix[i] *= (mix.length - i) / fade;
    }
  } else if (opts.music === false) mix = new Float32Array(len(duration));
  else mix = music(duration, style, bpm, seed, opts.outroAt).map((v) => v * 0.75);
  const r = rng(seed + 99);
  for (const c of cues) add(mix, sfx(c.sfx, c.len ?? 0.5, r), c.t, GAINS[c.sfx] ?? 0.5);
  if (opts.outroAt) add(mix, sfx("impact", 1, r), opts.outroAt, 0.8);
  const fade = len(0.6);
  let peak = 1e-6;
  for (let i = 0; i < mix.length; i++) {
    if (i < len(0.05)) mix[i] *= i / len(0.05);
    if (i > mix.length - fade) mix[i] *= (mix.length - i) / fade;
    mix[i] = Math.tanh(mix[i] * 1.2) / Math.tanh(1.2);
    peak = Math.max(peak, Math.abs(mix[i]));
  }
  for (let i = 0; i < mix.length; i++) mix[i] = (mix[i] / peak) * 0.85;
  return { samples: mix, sampleRate: SR };
}

export const PREVIEW_RATE = SR;

/**
 * Tempo of a music track (mono samples): onset strength from the energy envelope, then the
 * autocorrelation peak between 70 and 170 BPM. Good enough to snap cuts to the beat.
 */
export function estimateBpm(samples: Float32Array, rate: number): number {
  const hop = Math.round(rate / 100);
  const frames = Math.floor(samples.length / hop);
  if (frames < 400) return 120;
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) e += samples[i] * samples[i];
    energy[f] = Math.log(1e-6 + e);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  let best = 120;
  let bestScore = -1;
  for (let bpm = 70; bpm <= 170; bpm += 0.5) {
    const lag = (60 / bpm) * 100;
    let score = 0;
    for (let f = 0; f + lag * 2 < frames; f++) {
      const a = Math.round(f + lag);
      const b = Math.round(f + lag * 2);
      score += onset[f] * (onset[a] + 0.5 * onset[b]);
    }
    if (score > bestScore) { bestScore = score; best = bpm; }
  }
  return Math.round(best);
}
