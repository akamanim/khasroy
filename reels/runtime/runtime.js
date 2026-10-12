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

  /** Reveals words one after another: slide up from the line mask with a short fade. */
  function revealWords(words, t, start, step = 0.09, length = 0.5) {
    const block = words[0] && words[0].parentElement && words[0].parentElement.parentElement;
    if (block && !block.dataset.fitted) fitText(block, block.clientWidth || 920);
    words.forEach((w, i) => {
      const p = prog(t, start + i * step, length, ease.outQuint);
      w.style.transform = `translateY(${(1 - p) * 105}%)`;
      w.style.opacity = String(clamp(p * 1.6));
    });
  }

  /** Smaller type for long headlines so they still fit the frame. */
  const fit = (n, size) => (n > 14 ? size * 0.72 : n > 10 ? size * 0.84 : size);

  // ---------- transitions ----------
  // Each transition styles the *incoming* scene for p in [0, 1]; the outgoing one stays underneath.
  const transitions = {
    cut: () => ({}),
    fade: (p) => ({ opacity: String(ease.out(p)) }),
    slide: (p) => ({ transform: `translateY(${(1 - ease.outQuint(p)) * 100}%)` }),
    push: (p) => ({ transform: `translateX(${(1 - ease.outQuint(p)) * 100}%)` }),
    zoom: (p) => ({ transform: `scale(${lerp(1.18, 1, ease.outQuint(p))})`, opacity: String(ease.out(p)) }),
    // A diagonal edge sweeps the new scene in.
    wipe: (p) => {
      const e = lerp(-20, 120, ease.inOut(p));
      return { clipPath: `polygon(0 0, ${e + 18}% 0, ${e - 18}% 100%, 0 100%)` };
    },
    // A circle grows from the centre.
    iris: (p) => ({ clipPath: `circle(${ease.inOut(p) * 120}% at 50% 50%)` }),
  };
  const TRANSITION_TIME = { cut: 0, fade: 0.35, slide: 0.45, push: 0.45, zoom: 0.4, wipe: 0.55, iris: 0.5 };

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

    /** Registers a tool: { build(params, ctx) -> { node, update(t, dur) }, duration }. */
    register(name, tool) {
      tools[name] = tool;
    },

    load(plan) {
      const root = stage();
      root.innerHTML = "";
      this.scenes = [];
      let cursor = 0;
      (plan.scenes || []).forEach((scene, index) => {
        const tool = tools[scene.tool];
        if (!tool) throw new Error(`unknown tool: ${scene.tool}`);
        const params = scene.params || {};
        const dur = Math.max(0.6, Number(scene.duration) || tool.duration || 2.5);
        const transition = index === 0 ? "cut" : transitions[scene.transition] ? scene.transition : "cut";
        const overlap = TRANSITION_TIME[transition] || 0;
        const start = Math.max(0, cursor - overlap);
        const wrap = el("section", `scene bg-${params.bg || tool.bg || "cream"}`);
        wrap.dataset.tool = scene.tool;
        const built = tool.build(params, { index, seed: 1000 + index * 77, dur });
        wrap.appendChild(built.node);
        wrap.style.display = "none";
        wrap.style.zIndex = String(index + 1);
        root.appendChild(wrap);
        this.scenes.push({ wrap, built, start, dur, transition, overlap });
        cursor = start + dur;
      });
      this.duration = cursor;
      return this.duration;
    },

    seek(t) {
      for (const s of this.scenes) {
        const local = t - s.start;
        const visible = local >= 0 && local < s.dur + 1e-6;
        // A scene stays drawn while the next one transitions over it.
        s.wrap.style.display = visible ? "block" : "none";
        if (!visible) continue;
        s.built.update(local, s.dur);
        const fx = s.overlap ? transitions[s.transition](clamp(local / s.overlap)) : {};
        s.wrap.style.opacity = fx.opacity ?? "1";
        s.wrap.style.transform = fx.transform ?? "none";
        s.wrap.style.clipPath = fx.clipPath ?? "none";
      }
    },
  };

  window.reel = reel;
})();
