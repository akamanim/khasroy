// Reel runtime: turns a plan (list of scenes made from tools) into a deterministic animation.
// Every frame is a pure function of time — reel.seek(t) — so a recorder can capture frame by frame
// and the same plan always gives the same video. No dependencies.
(function () {
  "use strict";

  const W = 1080;
  const H = 1920;

  // ---------- math and easing ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = {
    linear: (p) => p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    outQuint: (p) => 1 - Math.pow(1 - p, 5),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    in: (p) => p * p * p,
    back: (p) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    // Damped spring that settles at 1 (a soft overshoot for cards and pop-ins).
    spring: (p) => (p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(11 * p)),
  };
  /** Progress of t through [start, start + length], eased. */
  const prog = (t, start, length, fn = ease.out) => fn(clamp((t - start) / Math.max(length, 1e-6)));

  // Deterministic pseudo-random numbers (mulberry32) so "random" details never flicker between renders.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- DOM helpers ----------
  function el(tag, className, style, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (style) Object.assign(node.style, style);
    if (html !== undefined) node.innerHTML = html;
    return node;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /**
   * Kinetic text: "*word*" marks accent words, "\n" breaks lines. Returns the block and the list of
   * word spans in reading order, so tools can reveal them one by one.
   */
  function kinetic(text, className, style) {
    const block = el("div", className, style);
    const words = [];
    String(text ?? "").split("\n").forEach((lineText) => {
      const line = el("span", "line");
      const parts = lineText.trim().split(/\s+/).filter(Boolean);
      parts.forEach((raw, i) => {
        const accent = /^\*.*\*[.,!?…:]*$/.test(raw);
        const clean = raw.replace(/\*/g, "");
        const w = el("span", `word${accent ? " accent" : ""}`, null, esc(clean) + (i < parts.length - 1 ? " " : ""));
        line.appendChild(w);
        words.push(w);
      });
      block.appendChild(line);
    });
    return { block, words };
  }

  /** Width of some text when laid out on one line, measured off-stage (no transforms involved). */
  function textWidth(html, className, fontSize) {
    const m = el("div", className, { position: "absolute", left: "-99999px", top: "0", display: "inline-block", whiteSpace: "nowrap", fontSize });
    m.innerHTML = html;
    document.body.appendChild(m);
    const w = m.offsetWidth;
    m.remove();
    return w;
  }

  /**
   * Shrinks a text block so its widest line fits maxWidth. Runs once, on the first frame the scene
   * is shown (fonts are loaded by then), so long words never get cut at the frame edge.
   */
  function fitText(node, maxWidth) {
    if (!node || node.dataset.fitted) return;
    node.dataset.fitted = "1";
    const size = parseFloat(node.style.fontSize) || parseFloat(getComputedStyle(node).fontSize);
    const lines = node.querySelectorAll(".line");
    const parts = lines.length ? Array.from(lines) : [node];
    const widest = Math.max(...parts.map((l) => textWidth(l.innerHTML, node.className, `${size}px`)));
    if (widest > maxWidth) node.style.fontSize = `${Math.floor((size * maxWidth) / widest)}px`;
  }

  /**
   * Reveals words one after another: each slides up out of its line mask, sharpening from a blur.
   * Accent words get a violet block that wipes in behind them when the block style is on.
   */
  function revealWords(words, t, start, step = 0.09, length = 0.5) {
    const block = words[0] && words[0].parentElement && words[0].parentElement.parentElement;
    if (block && !block.dataset.fitted) fitText(block, block.clientWidth || 920);
    words.forEach((w, i) => {
      const p = prog(t, start + i * step, length, ease.outQuint);
      w.style.transform = `translateY(${(1 - p) * 105}%) skewY(${(1 - p) * 6}deg)`;
      w.style.opacity = String(clamp(p * 1.6));
      w.style.filter = p < 0.98 ? `blur(${(1 - p) * 10}px)` : "none";
      if (w.classList.contains("accent") && block && block.classList.contains("hl")) {
        const hp = prog(t, start + i * step + length * 0.6, 0.35, ease.inOut);
        w.style.backgroundSize = `${hp * 100}% 100%`;
      }
    });
  }

  /** Smaller type for long headlines so they still fit the frame. */
  const fit = (n, size) => (n > 14 ? size * 0.72 : n > 10 ? size * 0.84 : size);

  // ---------- transitions ----------
  // A transition is centred on the cut: it starts half its length before the beat the next scene
  // lands on. It may style the incoming scene, the outgoing scene and a full-screen overlay.
  const transitions = {
    cut: { len: 0 },
    fade: { len: 0.4, in: (p) => ({ opacity: String(ease.inOut(p)) }) },
    slide: {
      len: 0.5,
      in: (p) => ({ transform: `translateY(${(1 - ease.outQuint(p)) * 100}%)` }),
      out: (p) => ({ transform: `translateY(${-ease.inOut(p) * 22}%) scale(${1 - 0.06 * p})`, filter: `brightness(${1 - 0.35 * p})` }),
    },
    push: {
      len: 0.5,
      in: (p) => ({ transform: `translateX(${(1 - ease.outQuint(p)) * 100}%)` }),
      out: (p) => ({ transform: `translateX(${-ease.outQuint(p) * 100}%)` }),
    },
    // Whip pan: both scenes rush sideways with motion blur.
    whip: {
      len: 0.36,
      in: (p) => ({ transform: `translateX(${(1 - ease.outExpo(p)) * 110}%)`, filter: `blur(${(1 - p) * 26}px)` }),
      out: (p) => ({ transform: `translateX(${-ease.in(p) * 110}%)`, filter: `blur(${p * 26}px)` }),
    },
    zoom: {
      len: 0.45,
      in: (p) => ({ transform: `scale(${lerp(1.35, 1, ease.outQuint(p))})`, opacity: String(ease.out(p)), filter: `blur(${(1 - p) * 14}px)` }),
      out: (p) => ({ transform: `scale(${lerp(1, 0.82, ease.inOut(p))})`, opacity: String(1 - ease.in(p)) }),
    },
    wipe: {
      len: 0.55,
      in: (p) => {
        const e = lerp(-20, 120, ease.inOut(p));
        return { clipPath: `polygon(0 0, ${e + 18}% 0, ${e - 18}% 100%, 0 100%)` };
      },
    },
    // A violet slab sweeps across, covers the frame for an instant and uncovers the next scene.
    slab: {
      len: 0.7,
      in: (p) => ({ opacity: p < 0.5 ? "0" : "1" }),
      overlay: (o, p) => {
        const x = lerp(-130, 130, ease.inOut(p));
        o.style.display = "block";
        o.style.background = "var(--violet)";
        o.style.clipPath = `polygon(${x - 35}% 0, ${x + 65}% 0, ${x + 35}% 100%, ${x - 65}% 100%)`;
      },
    },
    // Glitch cut: the frame tears into RGB for a few frames around the cut.
    glitch: {
      len: 0.3,
      in: (p) => ({ opacity: p < 0.5 ? "0" : "1", transform: `translateX(${Math.sin(p * 60) * 18 * (1 - p)}px)` }),
      out: (p) => ({ transform: `translateX(${Math.sin(p * 47) * 22 * p}px) skewX(${p * 4}deg)` }),
      overlay: (o, p) => {
        o.style.display = "block";
        const a = 0.45 * Math.sin(p * Math.PI);
        const shift = Math.round(Math.sin(p * 37) * 60);
        o.style.background = `repeating-linear-gradient(0deg, rgba(255,47,109,${a}) 0 10px, transparent 10px 38px, rgba(24,200,255,${a}) 38px 46px, transparent 46px 97px)`;
        o.style.backgroundPosition = `0 ${shift}px`;
        o.style.mixBlendMode = "screen";
        o.style.clipPath = `inset(${(Math.sin(p * 31) * 0.5 + 0.5) * 55}% 0 ${(Math.cos(p * 23) * 0.5 + 0.5) * 25}% 0)`;
      },
    },
    // The old scene splits into two halves that slide apart.
    split: {
      len: 0.55,
      out: (p) => {
        const d = ease.inOut(p) * 52;
        return { clipPath: `polygon(0 0, 100% 0, 100% ${50 - d}%, 0 ${50 - d}%, 0 ${50 + d}%, 100% ${50 + d}%, 100% 100%, 0 100%)` };
      },
      in: (p) => ({ transform: `scale(${lerp(1.12, 1, ease.outQuint(p))})` }),
    },
    iris: { len: 0.55, in: (p) => ({ clipPath: `circle(${ease.inOut(p) * 120}% at 50% 50%)` }) },
  };

  // Slow camera moves that keep every held frame alive; picked per scene.
  const cameras = {
    still: () => "none",
    push: (p) => `scale(${1 + 0.07 * p})`,
    pull: (p) => `scale(${1.08 - 0.07 * p})`,
    panL: (p) => `translateX(${lerp(24, -24, p)}px) scale(1.04)`,
    panR: (p) => `translateX(${lerp(-24, 24, p)}px) scale(1.04)`,
    tilt: (p) => `rotate(${lerp(-1.2, 0.6, p)}deg) scale(1.05)`,
    drift: (p) => `translate(${Math.sin(p * 3) * 10}px, ${lerp(16, -16, p)}px) scale(1.03)`,
  };

  // ---------- reel ----------
  const tools = {};
  const stage = () => document.getElementById("stage");

  const reel = {
    W,
    H,
    tools,
    helpers: { clamp, lerp, ease, prog, rng, el, esc, kinetic, revealWords, fit, fitText },
    scenes: [],
    duration: 0,
    bpm: 0,

    /** Registers a tool: { build(params, ctx) -> { node, update(t, dur), cues? }, duration }. */
    register(name, tool) {
      tools[name] = tool;
    },

    load(plan) {
      const root = stage();
      root.innerHTML = "";
      this.scenes = [];
      this.bpm = Number(plan.bpm) || 0;
      const overlay = el("div", null, { position: "absolute", inset: "0", zIndex: "999", display: "none", pointerEvents: "none" });
      this.overlay = overlay;
      let cut = 0;
      const list = plan.scenes || [];
      list.forEach((scene, index) => {
        const tool = tools[scene.tool];
        if (!tool) throw new Error(`unknown tool: ${scene.tool}`);
        const params = scene.params || {};
        const dur = Math.max(0.6, Number(scene.duration) || tool.duration || 2.5);
        const name = index === 0 ? "cut" : transitions[scene.transition] ? scene.transition : "cut";
        const tr = transitions[name];
        const half = (tr.len || 0) / 2;
        const wrap = el("section", `scene bg-${params.bg || tool.bg || "cream"}`);
        wrap.dataset.tool = scene.tool;
        const cam = el("div", null, { position: "absolute", inset: "0", transformOrigin: "50% 45%" });
        const seed = 1000 + index * 77 + (Number(plan.seed) || 0);
        const built = tool.build(params, { index, seed, dur });
        cam.appendChild(built.node);
        wrap.appendChild(cam);
        wrap.style.display = "none";
        wrap.style.zIndex = String(index + 1);
        root.appendChild(wrap);
        const camNames = Object.keys(cameras).filter((k) => k !== "still");
        const camera = cameras[scene.camera] ? scene.camera : camNames[(seed * 7) % camNames.length];
        // The scene's own clock starts when its transition begins; the cut sits on `cut`.
        this.scenes.push({ wrap, cam, built, tool: scene.tool, params, cut, start: cut - half, dur, name, tr, half, camera, seed });
        cut += dur;
      });
      root.appendChild(overlay);
      this.duration = cut;
      return this.duration;
    },

    /** Sound cues for the soundtrack: transitions, hits, pops and clicks with their times. */
    cues() {
      const out = [];
      this.scenes.forEach((s, i) => {
        if (i > 0 && s.name !== "cut") out.push({ t: Math.max(0, s.cut - s.half), sfx: s.name === "glitch" ? "glitch" : "whoosh", len: s.tr.len });
        if (i > 0 && s.name === "cut") out.push({ t: s.cut, sfx: "tick" });
        const own = s.built.cues ? s.built.cues(s.dur) : [];
        own.forEach((c) => out.push({ ...c, t: s.cut - s.half * 0.6 + c.at }));
      });
      return out.filter((c) => c.t >= 0 && c.t < this.duration).sort((a, b) => a.t - b.t);
    },

    seek(t) {
      const o = this.overlay;
      o.style.display = "none";
      o.style.mixBlendMode = "normal";
      for (let i = 0; i < this.scenes.length; i++) {
        const s = this.scenes[i];
        const next = this.scenes[i + 1];
        const end = next ? next.cut + next.half : this.duration;
        const visible = t >= s.start && t < end;
        s.wrap.style.display = visible ? "block" : "none";
        if (!visible) continue;
        // Local time counts from the moment the scene reaches the cut, so tool timings stay as designed.
        const local = Math.max(0, t - s.cut + s.half * 0.6);
        s.built.update(local, s.dur);
        s.cam.style.transform = cameras[s.camera](clamp((t - s.start) / (s.dur + s.half * 2)));
        let fx = {};
        if (s.half && t < s.cut + s.half && s.tr.in) fx = s.tr.in(clamp((t - s.start) / s.tr.len));
        if (next && next.half && t >= next.start && next.tr.out) fx = { ...fx, ...next.tr.out(clamp((t - next.start) / next.tr.len)) };
        if (next && next.half && t >= next.start && next.tr.overlay) next.tr.overlay(o, clamp((t - next.start) / next.tr.len));
        s.wrap.style.opacity = fx.opacity ?? "1";
        s.wrap.style.transform = fx.transform ?? "none";
        s.wrap.style.clipPath = fx.clipPath ?? "none";
        s.wrap.style.filter = fx.filter ?? "none";
        // Living grain: the noise shifts every frame.
        s.wrap.style.setProperty("--gx", `${Math.floor(t * 24) * 37 % 240}px`);
        s.wrap.style.setProperty("--gy", `${Math.floor(t * 24) * 53 % 240}px`);
      }
    },
  };

  window.reel = reel;
})();
