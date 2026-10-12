// Reel tools in the ИИнна style. Each tool builds one full-screen scene and animates it as a pure
// function of local time t (seconds). Parameters are plain JSON, so Khasroy can fill them in.
// Safe zone for Reels: keep important things between y≈220 and y≈1540, x 80…1000.
(function () {
  "use strict";
  const { clamp, lerp, ease, prog, rng, el, esc, kinetic, revealWords, fitText } = window.reel.helpers;
  const px = (n) => `${Math.round(n)}px`;

  // Sound cues per tool (seconds from the scene's own start); the soundtrack is built from them.
  const CUES = {
    slam: () => [{ at: 0.26, sfx: "impact" }],
    glitch: () => [{ at: 0.02, sfx: "glitch", len: 0.5 }],
    counter: () => [{ at: 0.35, sfx: "riser", len: 1.0 }, { at: 1.4, sfx: "pop" }],
    dot_grid: () => [{ at: 0.5, sfx: "riser", len: 1.4 }, { at: 1.95, sfx: "pop" }],
    notification: () => [{ at: 0.7, sfx: "notify" }],
    chat: (p) => {
      const n = Math.min(4, Array.isArray(p.messages) ? p.messages.length : 2);
      return Array.from({ length: n }, (_, i) => ({ at: 0.5 + i * 0.85, sfx: "pop" }));
    },
    voice: (p, dur) => [{ at: 0.7, sfx: "voice", len: Math.max(1, dur * 0.5) }, ...(p.reply ? [{ at: dur * 0.55 + 0.5, sfx: "pop" }] : [])],
    choice: () => [{ at: 0.3, sfx: "pop" }, { at: 1.85, sfx: "click" }],
    list: (p) => Array.from({ length: Math.min(4, Array.isArray(p.items) ? p.items.length : 3) }, (_, i) => ({ at: 0.6 + i * 0.42, sfx: "tick" })),
    product: () => [{ at: 0.3, sfx: "whoosh", len: 0.5 }, { at: 1.0, sfx: "pop" }],
    screen: () => [{ at: 1.0, sfx: "pop" }],
    badge: () => [{ at: 0.05, sfx: "whoosh", len: 0.6 }],
    outro: () => [{ at: 0.05, sfx: "impact" }, { at: 0.85, sfx: "pop" }],
  };
  const R = (name, tool) =>
    window.reel.register(name, {
      ...tool,
      build(p, ctx) {
        const built = tool.build(p, ctx);
        if (!built.cues && CUES[name]) built.cues = (dur) => CUES[name](p, dur);
        return built;
      },
    });

  /**
   * A phone that rises from the bottom with a 3D tilt; `content` is laid out on a 1080×1920 canvas
   * and shown scaled inside the screen.
   */
  function phone(content, { top = 600, wallpaper = "#0f0f12", offset = 0 } = {}) {
    const ph = el("div", "phone", { top: px(top) });
    ph.appendChild(el("div", "notch"));
    const screen = el("div", "screen", { background: wallpaper });
    const scale = 640 / 1080;
    Object.assign(content.style, { position: "absolute", left: "0", top: "0", width: "1080px", height: "1920px", transformOrigin: "0 0", transform: `scale(${scale}) translateY(${-offset}px)` });
    screen.appendChild(content);
    ph.appendChild(screen);
    return {
      node: ph,
      update(t, dur) {
        const rise = prog(t, 0.05, 0.9, ease.outQuint);
        const settle = prog(t, 0.05, dur, ease.inOut);
        ph.style.transform = `perspective(2200px) translateY(${(1 - rise) * 900}px) rotateX(${lerp(14, 6, settle)}deg) rotateY(${lerp(-18, -6, settle)}deg) rotateZ(${lerp(-3, 1, settle)}deg)`;
      },
    };
  }

  /** Font size that lets the longest line fit the safe width. */
  function headlineSize(text, base, width = 900) {
    const longest = String(text || "").split("\n").reduce((m, l) => Math.max(m, l.replace(/\*/g, "").trim().length), 1);
    return Math.min(base, width / (longest * 0.62));
  }

  function labelNode(text, style) {
    return el("div", "label", style, esc(text));
  }

  // 1. Headline — big capitals revealed word by word; *word* turns violet.
  R("headline", {
    duration: 2.6,
    bg: "cream",
    build(p) {
      const variant = p.variant || "stack";
      // "giant": one word per line, huge, stepping to the right; "block": accent words on a violet block.
      const raw = String(p.text || "");
      // Long single-line text is broken into lines of about 12 letters so it stays big.
      const wrap = (t) => {
        if (t.includes("\n")) return t;
        const out = [];
        let line = "";
        for (const w of t.split(/\s+/).filter(Boolean)) {
          if (line && (line + " " + w).replace(/\*/g, "").length > 12) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
        }
        if (line) out.push(line);
        return out.join("\n");
      };
      const text = variant === "giant" ? raw.replace(/\s*\n\s*/g, " ").split(/\s+/).join("\n") : wrap(raw);
      const base = variant === "giant" ? 260 : { m: 120, l: 160, xl: 210 }[p.size] || 160;
      const size = headlineSize(text, base);
      const { block, words } = kinetic(text, `display${p.size === "xl" || variant === "giant" ? " black" : ""}${variant === "block" ? " hl" : ""}`, {
        position: "absolute", left: "80px", right: "80px", fontSize: px(size),
      });
      const lineCount = text.split("\n").length;
      if (variant === "giant") block.querySelectorAll(".line").forEach((l, i) => { l.style.paddingLeft = `${i * 0.18}em`; });
      const align = p.align || "top";
      if (align === "top") block.style.top = "260px";
      else if (align === "bottom") block.style.bottom = "420px";
      else { block.style.top = "50%"; block.style.transform = "translateY(-50%)"; }
      const node = el("div", null, { position: "absolute", inset: "0" });
      node.appendChild(block);
      const label = p.label ? labelNode(p.label, { position: "absolute", left: "84px", bottom: align === "bottom" ? "340px" : "300px" }) : null;
      if (label) node.appendChild(label);
      return {
        node,
        update(t, dur) {
          // The stepped lines of "giant" need room for their indent.
          if (variant === "giant") fitText(block, 920 - (lineCount - 1) * 0.18 * (parseFloat(block.style.fontSize) || size));
          revealWords(words, t, 0.12, 0.085);
          // Slow drift keeps a held frame alive.
          node.style.transform = `translateY(${-14 * (t / dur)}px)`;
          if (label) label.style.opacity = String(prog(t, 0.25 + words.length * 0.085, 0.4));
        },
      };
    },
  });

  // 2. Slam — one huge word that lands with a punch ("НЕТ.").
  R("slam", {
    duration: 1.4,
    bg: "violet",
    build(p, ctx) {
      const text = String(p.text || "НЕТ.");
      const size = Math.min(430, 960 / (text.length * 0.62));
      const word = el("div", "display black", {
        position: "absolute", left: "0", right: "0", top: "50%", textAlign: "center",
        fontSize: px(size), transform: "translateY(-50%)", whiteSpace: "nowrap",
      }, esc(text));
      const node = el("div", null, { position: "absolute", inset: "0" });
      node.appendChild(word);
      const label = p.label ? labelNode(p.label, { position: "absolute", left: "0", right: "0", textAlign: "center", bottom: "460px" }) : null;
      if (label) node.appendChild(label);
      const r = rng(ctx.seed);
      const shakes = Array.from({ length: 8 }, () => [r() * 2 - 1, r() * 2 - 1]);
      return {
        node,
        update(t) {
          fitText(word, 960);
          const land = prog(t, 0, 0.32, ease.outExpo);
          const scale = lerp(1.45, 1, land) * (1 + 0.025 * clamp((t - 0.35) / 2));
          const shakeAmt = Math.max(0, 1 - (t - 0.28) / 0.22) * (t > 0.28 ? 14 : 0);
          const s = shakes[Math.floor(t * 40) % shakes.length];
          word.style.transform = `translate(${s[0] * shakeAmt}px, calc(-50% + ${s[1] * shakeAmt}px)) scale(${scale})`;
          word.style.opacity = String(clamp(t / 0.08));
          if (label) label.style.opacity = String(prog(t, 0.45, 0.3));
        },
      };
    },
  });

  // 3. Counter — a big number that counts up, with a headline and a caption.
  R("counter", {
    duration: 2.8,
    bg: "cream",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const head = p.headline ? kinetic(p.headline, "display", { position: "absolute", left: "80px", right: "80px", top: "260px", fontSize: px(headlineSize(p.headline, 120)) }) : null;
      if (head) node.appendChild(head.block);
      const value = String(p.value ?? "168");
      const numeric = /^-?\d+$/.test(value.replace(/\s/g, ""));
      const target = numeric ? Number(value.replace(/\s/g, "")) : 0;
      const from = Number(p.from) || 0;
      const ring = p.variant === "ring";
      const size = ring ? Math.min(300, 620 / (value.length * 0.62)) : Math.min(520, 980 / (value.length * 0.62));
      const num = el("div", "display black accent", ring
        ? { position: "absolute", left: "0", right: "0", top: "960px", textAlign: "center", fontSize: px(size), letterSpacing: "-0.05em", lineHeight: "0.8", transformOrigin: "50% 50%" }
        : { position: "absolute", left: "70px", bottom: "520px", fontSize: px(size), letterSpacing: "-0.05em", lineHeight: "0.8" });
      let arc = null;
      if (ring) {
        const svg = el("div", null, { position: "absolute", left: "190px", top: "690px", width: "700px", height: "700px" });
        svg.innerHTML = `<svg viewBox="0 0 700 700" width="700" height="700"><circle cx="350" cy="350" r="320" fill="none" stroke="currentColor" stroke-opacity=".12" stroke-width="22"/><circle class="arc" cx="350" cy="350" r="320" fill="none" stroke="var(--violet)" stroke-width="22" stroke-linecap="round" stroke-dasharray="2011" stroke-dashoffset="2011" transform="rotate(-90 350 350)"/></svg>`;
        node.appendChild(svg);
        arc = svg.querySelector(".arc");
      }
      const bgViolet = p.bg === "violet";
      if (bgViolet) num.style.color = "var(--white)";
      node.appendChild(num);
      const label = p.label ? labelNode(p.label, ring ? { position: "absolute", left: "0", right: "0", textAlign: "center", top: "1230px" } : { position: "absolute", left: "84px", bottom: "430px" }) : null;
      if (label) node.appendChild(label);
      const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return {
        node,
        update(t) {
          if (head) revealWords(head.words, t, 0.1, 0.08);
          const p2 = prog(t, 0.35, 1.1, ease.outExpo);
          num.textContent = numeric ? fmt(lerp(from, target, p2)) : value.slice(0, Math.ceil(value.length * prog(t, 0.35, 0.6, ease.linear)));
          num.style.transform = ring
            ? `translateY(-50%) scale(${lerp(0.6, 1, prog(t, 0.3, 0.6, ease.back))})`
            : `translateY(${(1 - prog(t, 0.3, 0.5, ease.outQuint)) * 80}px)`;
          num.style.opacity = String(prog(t, 0.3, 0.25));
          if (arc) arc.style.strokeDashoffset = String(2011 * (1 - prog(t, 0.35, 1.1, ease.outExpo)));
          if (label) label.style.opacity = String(prog(t, 0.9, 0.4));
        },
      };
    },
  });

  // 4. Dot grid — hours/days as dots filling up, one highlighted, with a number and caption.
  R("dot_grid", {
    duration: 3.2,
    bg: "cream",
    build(p) {
      const cols = clamp(Math.round(Number(p.columns) || 7), 3, 10);
      const rows = clamp(Math.round(Number(p.rows) || 24), 4, 30);
      const filled = clamp(Number(p.filled ?? 0.2), 0, 1);
      const total = cols * rows;
      const fillCount = Math.round(total * filled);
      const node = el("div", null, { position: "absolute", inset: "0" });
      const headText = p.headline || "Многие\n*думают…*";
      const headSize = headlineSize(headText, 96);
      const head = kinetic(headText, "display", { position: "absolute", left: "80px", right: "80px", top: "240px", fontSize: px(headSize) });
      node.appendChild(head.block);
      const headLines = String(headText).split("\n").length;
      const top = Math.max(500, 240 + headLines * headSize * 0.95 + 70);
      const hasNumber = p.number !== undefined && p.number !== "";
      const bottom = hasNumber ? 1290 : 1460;
      const left = 120;
      const right = 960;
      const dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const d = el("span", null, {
            position: "absolute",
            left: px(lerp(left, right, cols === 1 ? 0.5 : c / (cols - 1)) - 11),
            top: px(lerp(top, bottom, rows === 1 ? 0.5 : r / (rows - 1)) - 11),
            width: "22px", height: "22px", borderRadius: "50%",
            border: "2.5px solid #b9b4ab", boxSizing: "border-box",
          });
          node.appendChild(d);
          dots.push(d);
        }
      }
      const num = el("div", "display black accent", { position: "absolute", left: "70px", bottom: "330px", fontSize: "210px", letterSpacing: "-0.05em", lineHeight: "0.8" });
      const label = labelNode(p.label || "часов в неделю", { position: "absolute", left: "84px", bottom: "270px", fontSize: "26px" });
      if (hasNumber) node.append(num, label);
      const target = Number(p.number) || 0;
      return {
        node,
        update(t) {
          revealWords(head.words, t, 0.1, 0.08);
          const shown = Math.round(fillCount * prog(t, 0.5, 1.4, ease.inOut));
          const appear = prog(t, 0.15, 0.4);
          dots.forEach((d, i) => {
            const on = i < shown;
            const highlight = i === shown - 1 && shown === fillCount && fillCount > 0;
            d.style.opacity = String(appear);
            d.style.background = highlight ? "var(--violet)" : on ? "var(--ink)" : "transparent";
            d.style.borderColor = highlight ? "var(--violet)" : on ? "var(--ink)" : "#b9b4ab";
            d.style.transform = highlight ? `scale(${1 + 0.35 * Math.sin(Math.min(1, prog(t, 1.9, 0.5, ease.linear)) * Math.PI)})` : "none";
          });
          num.textContent = String(Math.round(target * prog(t, 0.5, 1.4, ease.inOut)));
          num.style.opacity = String(prog(t, 0.4, 0.3));
          label.style.opacity = String(prog(t, 0.6, 0.3));
        },
      };
    },
  });

  // 5. Notification — a phone push "Пришёл новый заказ" drops in over a big headline.
  R("notification", {
    duration: 2.8,
    bg: "black",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const head = kinetic(p.headline || "Новый\n*заказ*", "display black", { position: "absolute", left: "80px", right: "80px", top: "300px", fontSize: px(headlineSize(p.headline || "Новый заказ", 210)) });
      node.appendChild(head.block);
      const sub = p.sub ? labelNode(p.sub, { position: "absolute", left: "84px", top: "820px", color: "#8d8d8d" }) : null;
      if (sub) node.appendChild(sub);
      const card = el("div", "card", { left: "80px", right: "80px", top: "980px", padding: "36px 40px", borderRadius: "44px", background: "#f2efe9", color: "var(--ink)" });
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;font-family:Inter;font-weight:600;font-size:24px;letter-spacing:.12em;color:#8a867f;text-transform:uppercase">
          <span style="width:12px;height:12px;border-radius:50%;background:var(--violet)"></span>${esc(p.app || "Telegram")}
          <span style="margin-left:auto;letter-spacing:.08em">${esc(p.time || "сейчас")}</span>
        </div>
        <div style="display:flex;align-items:center;gap:28px;margin-top:26px">
          <div style="width:104px;height:104px;border-radius:26px;background:var(--violet);color:#fff;display:grid;place-items:center;font-family:'Inter Display';font-weight:900;font-size:58px">${esc(p.icon || "И")}</div>
          <div style="min-width:0">
            <div style="font-family:'Inter Display';font-weight:700;font-size:46px;letter-spacing:-.01em">${esc(p.title || "Пришёл новый заказ")}</div>
            <div style="font-family:Inter;font-weight:500;font-size:34px;color:#6d6a64;margin-top:6px">${esc(p.body || "Алексей К. · 4 900 сом")}</div>
          </div>
        </div>`;
      node.appendChild(card);
      let device = null;
      if (p.variant === "phone") {
        // Lock screen in a phone; the headline stays above it.
        head.block.style.top = "230px";
        head.block.style.fontSize = px(headlineSize(p.headline || "Новый заказ", 150));
        if (sub) sub.remove();
        const lock = el("div", null, { background: "radial-gradient(ellipse at 30% 10%, #3b2a7a, #120d22 60%, #09080d)" });
        lock.innerHTML = `<div style="position:absolute;left:0;right:0;top:250px;text-align:center;color:#fff;font-family:'Inter Display';font-weight:600;font-size:250px;letter-spacing:-.03em">${esc(p.clock || "23:47")}</div>
          <div style="position:absolute;left:0;right:0;top:210px;text-align:center;color:rgba(255,255,255,.75);font-family:Inter;font-weight:500;font-size:44px">${esc(p.date || "понедельник")}</div>`;
        card.remove();
        Object.assign(card.style, { top: "640px", left: "60px", right: "60px", background: "rgba(245,242,236,.94)" });
        lock.appendChild(card);
        device = phone(lock, { top: 560, wallpaper: "#120d22" });
        node.appendChild(device.node);
      }
      return {
        node,
        update(t, dur) {
          revealWords(head.words, t, 0.08, 0.1);
          if (device) device.update(t, dur);
          if (sub) sub.style.opacity = String(prog(t, 0.45, 0.3));
          const drop = prog(t, 0.65, 0.9, ease.spring);
          card.style.transform = `translateY(${(1 - drop) * -1150}px) scale(${lerp(0.94, 1, drop)})`;
          card.style.opacity = String(prog(t, 0.65, 0.15));
        },
      };
    },
  });

  // 6. Chat — client and ИИнна messages appear one by one; typing dots before each reply.
  R("chat", {
    duration: 4.2,
    bg: "cream",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const dark = p.bg === "black";
      const messages = (Array.isArray(p.messages) && p.messages.length ? p.messages : [
        { from: "client", text: "Здравствуйте! Есть чёрный на подарок?" },
        { from: "me", text: "Конечно! Есть чёрный с гравировкой — успеем на завтра :)" },
      ]).slice(0, 5);
      if (p.headline) {
        const h = el("div", "label", { position: "absolute", left: "84px", top: "250px", color: dark ? "#8d8d8d" : "var(--muted)" }, esc(p.headline));
        node.appendChild(h);
      }
      const header = el("div", null, { position: "absolute", left: "80px", right: "80px", top: "320px", display: "flex", alignItems: "center", gap: "22px" });
      header.innerHTML = `<div style="width:84px;height:84px;border-radius:50%;background:${dark ? "#2a2a2a" : "var(--ink)"};color:#fff;display:grid;place-items:center;font-family:'Inter Display';font-weight:700;font-size:40px">${esc((p.contact || "Алексей К.").slice(0, 1))}</div>
        <div><div style="font-family:'Inter Display';font-weight:700;font-size:40px">${esc(p.contact || "Алексей К.")}</div><div style="font-family:Inter;font-weight:500;font-size:26px;color:#8a867f">${esc(p.channel || "Instagram Direct")}</div></div>`;
      node.appendChild(header);
      const list = el("div", null, { position: "absolute", left: "80px", right: "80px", top: "470px", display: "flex", flexDirection: "column", gap: "26px" });
      node.appendChild(list);
      const items = [];
      let at = 0.45;
      messages.forEach((m) => {
        const mine = m.from !== "client";
        let typing = null;
        if (mine) {
          typing = el("div", "pill", { alignSelf: "flex-end", padding: "26px 34px", gap: "12px", background: "var(--violet)" });
          typing.innerHTML = "<i></i><i></i><i></i>";
          Array.from(typing.children).forEach((d) => Object.assign(d.style, { width: "16px", height: "16px", borderRadius: "50%", background: "#fff", display: "block" }));
          list.appendChild(typing);
          items.push({ node: typing, start: at, typing: true, end: at + 0.65 });
          at += 0.65;
        }
        const bubble = el("div", null, {
          alignSelf: mine ? "flex-end" : "flex-start",
          maxWidth: "800px",
          padding: "30px 38px",
          borderRadius: mine ? "40px 40px 12px 40px" : "40px 40px 40px 12px",
          background: mine ? "var(--violet)" : dark ? "#1f1f1f" : "#fbf9f5",
          color: mine ? "#fff" : dark ? "var(--white)" : "var(--ink)",
          border: mine ? "none" : dark ? "1px solid #2c2c2c" : "2px solid #d9d4ca",
          fontFamily: "'Inter Display'", fontWeight: "600", fontSize: "42px", lineHeight: "1.25",
          transformOrigin: mine ? "100% 100%" : "0% 100%",
        }, esc(m.text).replace(/\*([^*]+)\*/g, `<b style="background:${mine ? "rgba(255,255,255,.22)" : "var(--violet-soft)"};border-radius:10px;padding:0 8px">$1</b>`));
        list.appendChild(bubble);
        items.push({ node: bubble, start: at });
        at += mine ? 0.9 : 0.75;
      });
      let device = null;
      let head = null;
      if (p.variant === "phone") {
        // The conversation lives in a phone; a big headline sits above it.
        const content = el("div", null, { background: dark ? "#111" : "var(--cream)" });
        Array.from(node.children).forEach((c) => content.appendChild(c));
        // Bigger type inside the phone so it still reads at phone size.
        list.querySelectorAll(":scope > div").forEach((b) => { if (b.style.fontSize) b.style.fontSize = "62px"; });
        list.style.gap = "34px";
        device = phone(content, { top: 600, wallpaper: dark ? "#111" : "#ede9e1", offset: 150 });
        node.appendChild(device.node);
        const bigText = p.title || p.headline || "";
        if (bigText) {
          head = kinetic(bigText, "display black", { position: "absolute", left: "80px", right: "80px", top: "240px", fontSize: px(headlineSize(bigText, 140)) });
          node.appendChild(head.block);
          content.querySelectorAll(".label").forEach((l) => l.remove());
        }
      }
      return {
        node,
        update(t, dur) {
          if (device) device.update(t, dur);
          if (head) revealWords(head.words, t, 0.05, 0.08);
          header.style.opacity = String(prog(t, 0.05, 0.3));
          header.style.transform = `translateY(${(1 - prog(t, 0.05, 0.4)) * 20}px)`;
          for (const it of items) {
            if (it.typing) {
              const show = t >= it.start && t < it.end;
              it.node.style.display = show ? "inline-flex" : "none";
              Array.from(it.node.children).forEach((d, i) => { d.style.transform = `translateY(${Math.sin((t - it.start) * 12 - i * 0.9) * 6}px)`; });
              continue;
            }
            const p2 = prog(t, it.start, 0.55, ease.spring);
            it.node.style.display = t >= it.start ? "block" : "none";
            it.node.style.opacity = String(clamp((t - it.start) / 0.12));
            it.node.style.transform = `translateY(${(1 - p2) * 30}px) scale(${lerp(0.86, 1, p2)})`;
          }
        },
      };
    },
  });

  // 7. Voice — a voice message plays: waveform, playhead, timer; then the transcript and a reply.
  R("voice", {
    duration: 4.0,
    bg: "black",
    build(p, ctx) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      node.appendChild(el("div", "glow-arc"));
      const kicker = labelNode(p.kicker || "ИИнна", { position: "absolute", left: "86px", top: "250px", color: "var(--violet)", fontSize: "26px" });
      const head = kinetic(p.headline || "Слушаю", "display black", { position: "absolute", left: "80px", right: "80px", top: "290px", fontSize: px(headlineSize(p.headline || "Слушаю", 190)) });
      node.append(kicker, head.block);
      const who = labelNode(`${p.who || "Алексей К."} · ${p.label || "голосовое"}`, { position: "absolute", left: "86px", top: "600px", color: "#8d8d8d", fontSize: "26px" });
      node.appendChild(who);
      const card = el("div", "card", { left: "80px", right: "80px", top: "660px", height: "200px", display: "flex", alignItems: "center", gap: "34px", padding: "0 44px" });
      const play = el("div", null, { width: "120px", height: "120px", borderRadius: "50%", background: "var(--violet)", display: "grid", placeItems: "center", flex: "none" });
      play.innerHTML = '<div style="width:0;height:0;border-left:38px solid #fff;border-top:24px solid transparent;border-bottom:24px solid transparent;margin-left:10px"></div>';
      const wave = el("div", null, { flex: "1", height: "120px", display: "flex", alignItems: "center", gap: "7px", position: "relative" });
      const r = rng(ctx.seed);
      const bars = Array.from({ length: 34 }, (_, i) => {
        const h = 18 + Math.pow(r(), 1.3) * 92 * (0.55 + 0.45 * Math.sin(i * 0.5) ** 2);
        const b = el("span", null, { width: "8px", height: px(h), borderRadius: "4px", background: "#6b6b6b", flex: "none" });
        wave.appendChild(b);
        return b;
      });
      const head2 = el("span", null, { position: "absolute", top: "-6px", bottom: "-6px", width: "4px", borderRadius: "2px", background: "#fff", boxShadow: "0 0 18px rgba(255,255,255,.7)" });
      wave.appendChild(head2);
      const timer = el("div", null, { fontFamily: "Inter", fontWeight: "600", fontSize: "34px", color: "#bdbdbd", flex: "none" });
      card.append(play, wave, timer);
      node.appendChild(card);
      const totalSec = (() => { const m = /(\d+):(\d+)/.exec(p.duration || "0:07"); return m ? Number(m[1]) * 60 + Number(m[2]) : 7; })();
      const transcript = p.transcript ? el("div", null, { position: "absolute", left: "80px", right: "80px", top: "930px", fontFamily: "'Inter Display'", fontWeight: "700", fontSize: "50px", lineHeight: "1.35" },
        esc(p.transcript).replace(/\*([^*]+)\*/g, '<span style="background:var(--violet);border-radius:10px;padding:0 10px">$1</span>')) : null;
      if (transcript) node.appendChild(transcript);
      const reply = p.reply ? el("div", null, { position: "absolute", right: "80px", top: transcript ? "1240px" : "960px", maxWidth: "760px", padding: "30px 38px", borderRadius: "40px 40px 12px 40px", background: "var(--cream)", color: "var(--ink)", fontFamily: "'Inter Display'", fontWeight: "600", fontSize: "40px", lineHeight: "1.25" }, esc(p.reply)) : null;
      if (reply) node.appendChild(reply);
      return {
        node,
        update(t, dur) {
          kicker.style.opacity = String(prog(t, 0, 0.3));
          revealWords(head.words, t, 0.05, 0.08);
          who.style.opacity = String(prog(t, 0.3, 0.3));
          const cin = prog(t, 0.3, 0.6, ease.spring);
          card.style.transform = `translateY(${(1 - cin) * 60}px)`;
          card.style.opacity = String(prog(t, 0.3, 0.2));
          const playEnd = transcript || reply ? dur * 0.55 : dur - 0.3;
          const pos = prog(t, 0.7, playEnd - 0.7, ease.linear);
          const n = bars.length;
          bars.forEach((b, i) => {
            const played = i / n < pos;
            b.style.background = played ? "var(--violet)" : "#5c5c5c";
            const live = played && i / n > pos - 0.12 ? 1 + 0.25 * Math.sin(t * 30 + i) : 1;
            b.style.transform = `scaleY(${live})`;
          });
          head2.style.left = `calc(${pos * 100}% - 2px)`;
          head2.style.opacity = String(pos > 0 && pos < 1 ? 1 : 0);
          const sec = Math.round(totalSec * pos);
          timer.textContent = `0:${String(sec).padStart(2, "0")}`;
          if (transcript) {
            const tp = prog(t, playEnd, 0.5, ease.outQuint);
            transcript.style.opacity = String(tp);
            transcript.style.transform = `translateY(${(1 - tp) * 30}px)`;
          }
          if (reply) {
            const rp = prog(t, playEnd + 0.5, 0.55, ease.spring);
            reply.style.opacity = String(clamp((t - playEnd - 0.5) / 0.12));
            reply.style.transform = `translateY(${(1 - rp) * 30}px) scale(${lerp(0.88, 1, rp)})`;
          }
        },
      };
    },
  });

  // 8. Choice — a question and two buttons; a finger taps one of them.
  R("choice", {
    duration: 3.0,
    bg: "cream",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const dark = p.bg === "black";
      const head = p.headline ? kinetic(p.headline, "display black", { position: "absolute", left: "80px", right: "80px", top: "260px", fontSize: px(headlineSize(p.headline, 170)) }) : null;
      if (head) node.appendChild(head.block);
      const q = el("div", null, {
        position: "absolute", left: "80px", right: "80px", top: "820px", padding: "40px 44px", borderRadius: "36px",
        background: dark ? "#1b1b1b" : "#fbf9f5", border: `3px solid ${dark ? "#2e2e2e" : "var(--ink)"}`,
        fontFamily: "'Inter Display'", fontWeight: "700", fontSize: "50px", lineHeight: "1.2",
        boxShadow: "8px 8px 0 var(--violet)",
      }, esc(p.question || "Клиент просит скидку 10%. Согласны?"));
      node.appendChild(q);
      const opts = (Array.isArray(p.options) && p.options.length ? p.options : ["Да", "Нет"]).slice(0, 2);
      const pick = clamp(Number(p.pick ?? 0), 0, opts.length - 1);
      const row = el("div", null, { position: "absolute", left: "80px", right: "80px", top: "1120px", display: "flex", gap: "30px" });
      const buttons = opts.map((o) => {
        const b = el("div", "pill", { flex: "1", height: "150px", fontSize: "52px", border: `3px solid ${dark ? "#444" : "var(--ink)"}`, background: dark ? "#141414" : "#fbf9f5", color: dark ? "#fff" : "var(--ink)" }, esc(o));
        row.appendChild(b);
        return b;
      });
      node.appendChild(row);
      const finger = el("div", null, { position: "absolute", width: "110px", height: "110px", borderRadius: "50%", background: "rgba(136,83,253,.25)", border: "4px solid var(--violet)", left: "0", top: "0" });
      node.appendChild(finger);
      return {
        node,
        update(t) {
          if (head) revealWords(head.words, t, 0.05, 0.08);
          const qp = prog(t, 0.25, 0.6, ease.spring);
          q.style.opacity = String(prog(t, 0.25, 0.15));
          q.style.transform = `translateY(${(1 - qp) * 50}px) rotate(${(1 - qp) * -2}deg)`;
          buttons.forEach((b, i) => {
            const bp = prog(t, 0.7 + i * 0.12, 0.5, ease.spring);
            b.style.opacity = String(prog(t, 0.7 + i * 0.12, 0.15));
            b.style.transform = `translateY(${(1 - bp) * 40}px)`;
          });
          // The finger travels from the bottom right to the chosen button and presses it.
          const target = { x: pick === 0 ? 300 : 780, y: 1195 };
          const mv = prog(t, 1.2, 0.6, ease.inOut);
          finger.style.left = px(lerp(980, target.x, mv) - 55);
          finger.style.top = px(lerp(1700, target.y, mv) - 55);
          finger.style.opacity = String(prog(t, 1.1, 0.2) * (1 - prog(t, 2.2, 0.3)));
          const press = t > 1.85 ? 1 : 0;
          finger.style.transform = `scale(${t > 1.8 && t < 2.0 ? 0.82 : 1})`;
          const chosen = buttons[pick];
          chosen.style.background = press ? "var(--violet)" : dark ? "#141414" : "#fbf9f5";
          chosen.style.color = press ? "#fff" : dark ? "#fff" : "var(--ink)";
          chosen.style.borderColor = press ? "var(--violet)" : dark ? "#444" : "var(--ink)";
          if (press) chosen.style.transform = `scale(${1 + 0.06 * Math.sin(prog(t, 1.85, 0.3, ease.linear) * Math.PI)})`;
        },
      };
    },
  });

  // 9. Product — a product card flips up into view with price and tag.
  R("product", {
    duration: 3.0,
    bg: "cream",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0", perspective: "1600px" });
      const head = p.headline ? kinetic(p.headline, "display black", { position: "absolute", left: "80px", right: "80px", top: "240px", fontSize: px(headlineSize(p.headline, 130)) }) : null;
      if (head) node.appendChild(head.block);
      const card = el("div", "card", { left: "140px", right: "140px", top: head ? "560px" : "380px", height: "980px", overflow: "hidden", transformOrigin: "50% 100%" });
      const media = el("div", null, { height: "640px", position: "relative", background: "linear-gradient(150deg, #a27bff, #8853fd 45%, #2b1a55)", display: "grid", placeItems: "center" });
      if (p.image) {
        media.innerHTML = `<img src="${esc(p.image)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />`;
      } else {
        media.innerHTML = `<div class="display black" style="font-size:300px;color:rgba(255,255,255,.92)">${esc((p.name || "Cuff 01").slice(0, 1))}</div>`;
      }
      const tag = p.tag ? el("div", "pill", { position: "absolute", left: "36px", top: "36px", padding: "16px 30px", fontSize: "30px", background: "#fff", color: "var(--ink)" }, esc(p.tag)) : null;
      if (tag) media.appendChild(tag);
      const info = el("div", null, { padding: "40px 46px" });
      info.innerHTML = `<div style="font-family:'Inter Display';font-weight:700;font-size:56px;letter-spacing:-.01em">${esc(p.name || "Cuff 01")}</div>
        <div style="font-family:Inter;font-weight:500;font-size:32px;color:#8a867f;margin-top:8px">${esc(p.caption || "")}</div>`;
      const price = el("div", "display black accent", { fontSize: "84px", marginTop: "26px", letterSpacing: "-0.03em" }, esc(p.price || "2 900 сом"));
      info.appendChild(price);
      card.append(media, info);
      node.appendChild(card);
      return {
        node,
        update(t, dur) {
          if (head) revealWords(head.words, t, 0.05, 0.08);
          const cp = prog(t, 0.3, 0.9, ease.spring);
          card.style.opacity = String(prog(t, 0.3, 0.15));
          card.style.transform = `translateY(${(1 - cp) * 260}px) rotateX(${(1 - cp) * 28}deg) rotateZ(${Math.sin(t * 1.2) * 0.6}deg)`;
          media.style.transform = `scale(${1 + 0.05 * (t / dur)})`;
          if (tag) tag.style.transform = `scale(${prog(t, 0.95, 0.45, ease.back)})`;
          price.style.opacity = String(prog(t, 1.0, 0.3));
          price.style.transform = `translateY(${(1 - prog(t, 1.0, 0.4)) * 20}px)`;
        },
      };
    },
  });

  // 10. Badge — the ИИнна badge swings in on a lanyard ("Ваш личный менеджер").
  R("badge", {
    duration: 3.0,
    bg: "cream",
    build(p, ctx) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const rig = el("div", null, { position: "absolute", left: "50%", top: "-40px", width: "0", height: "0", transformOrigin: "0 0" });
      const strap = el("div", null, { position: "absolute", left: "-22px", top: "0", width: "44px", height: "340px", background: "var(--ink)", borderRadius: "6px" });
      const badge = el("div", null, { position: "absolute", left: "-245px", top: "320px", width: "490px", height: "680px", borderRadius: "48px", background: "var(--ink)", color: "#fff", boxShadow: "0 50px 90px rgba(0,0,0,.28)", display: "flex", flexDirection: "column", alignItems: "center" });
      const r = rng(ctx.seed);
      const barcode = Array.from({ length: 46 }, () => `<i style="display:inline-block;height:80px;width:${2 + Math.round(r() * 6)}px;margin-right:${2 + Math.round(r() * 4)}px;background:#fff"></i>`).join("");
      badge.innerHTML = `<div style="width:130px;height:22px;border-radius:12px;background:var(--cream);margin-top:34px"></div>
        <div style="width:250px;height:250px;border-radius:50%;background:var(--violet);margin-top:64px;display:grid;place-items:center;font-family:'Inter Display';font-weight:900;font-size:150px">${esc(p.letter || "И")}</div>
        <div style="font-family:'Inter Display';font-weight:800;font-weight:900;font-size:86px;margin-top:44px;letter-spacing:-.02em">${esc(p.name || "ИИнна")}<span style="color:var(--violet)">.</span></div>
        <div class="label" style="font-size:24px;color:#bdbdbd;margin-top:8px">${esc(p.role || "личный менеджер")}</div>
        <div style="margin-top:auto;margin-bottom:48px;white-space:nowrap;overflow:hidden;width:420px">${barcode}</div>`;
      rig.append(strap, badge);
      node.appendChild(rig);
      const head = kinetic(p.headline || "*Ваш*\nличный\nменеджер", "display black", { position: "absolute", left: "80px", right: "80px", bottom: "330px", fontSize: px(headlineSize(p.headline || "менеджер", 140)) });
      node.appendChild(head.block);
      return {
        node,
        update(t) {
          const drop = prog(t, 0, 0.7, ease.outQuint);
          const swing = 16 * Math.exp(-2.2 * t) * Math.cos(5.2 * t);
          rig.style.transform = `translateY(${(1 - drop) * -1300}px) rotate(${swing}deg)`;
          revealWords(head.words, t, 0.75, 0.1);
        },
      };
    },
  });

  // 11. Glitch — a word shakes in RGB split, then snaps clean.
  R("glitch", {
    duration: 1.8,
    bg: "cream",
    build(p, ctx) {
      const text = String(p.text || "Может?");
      const size = headlineSize(text, 300, 940);
      const html = String(text).split("\n").map((l) => `<span class="line" style="overflow:visible">${esc(l.replace(/\*/g, ""))}</span>`).join("");
      const node = el("div", null, { position: "absolute", inset: "0" });
      const mk = (color, blend) => el("div", "display black", { position: "absolute", left: "70px", right: "70px", top: "50%", textAlign: "center", fontSize: px(size), color, mixBlendMode: blend, whiteSpace: "nowrap" }, html);
      const dark = p.bg === "black" || p.bg === "violet";
      const a = mk("#ff2f6d", dark ? "screen" : "multiply");
      const b = mk("#18c8ff", dark ? "screen" : "multiply");
      const c = mk(dark ? "#fff" : "var(--ink)", "normal");
      node.append(a, b, c);
      const r = rng(ctx.seed);
      const jit = Array.from({ length: 24 }, () => [r() * 2 - 1, r() * 2 - 1, r(), r()]);
      return {
        node,
        update(t) {
          if (!c.dataset.fitted) { fitText(c, 940); a.style.fontSize = b.style.fontSize = c.style.fontSize; }
          const k = Math.floor(t * 24) % jit.length;
          const strength = t < 0.9 ? 1 - t / 0.9 : 0;
          const j = jit[k];
          const off = 26 * strength;
          a.style.transform = `translate(${j[0] * off - off}px, calc(-50% + ${j[1] * off * 0.4}px))`;
          b.style.transform = `translate(${-j[0] * off + off}px, calc(-50% - ${j[1] * off * 0.4}px))`;
          a.style.opacity = b.style.opacity = String(strength > 0.02 ? 0.9 : 0);
          const slice = strength > 0.15 && j[2] > 0.45;
          c.style.clipPath = slice ? `inset(${j[3] * 60}% 0 ${(1 - j[3]) * 30}% 0)` : "none";
          c.style.transform = `translate(${slice ? j[0] * 30 : 0}px, -50%) scale(${1 + 0.03 * strength})`;
          node.style.opacity = String(clamp(t / 0.06));
        },
      };
    },
  });

  // 12. List — checklist items tick in one by one.
  R("list", {
    duration: 3.4,
    bg: "black",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const head = kinetic(p.headline || "Что я *умею*", "display black", { position: "absolute", left: "80px", right: "80px", top: "260px", fontSize: px(headlineSize(p.headline || "Что я умею", 140)) });
      node.appendChild(head.block);
      const items = (Array.isArray(p.items) && p.items.length ? p.items : ["Отвечаю 24/7", "Принимаю заказы", "Понимаю голосовые"]).slice(0, 5);
      const list = el("div", null, { position: "absolute", left: "80px", right: "80px", top: "720px", display: "flex", flexDirection: "column", gap: "40px" });
      const rows = items.map((text) => {
        const row = el("div", null, { display: "flex", alignItems: "center", gap: "34px" });
        row.innerHTML = `<svg width="88" height="88" viewBox="0 0 88 88" style="flex:none"><circle cx="44" cy="44" r="40" fill="var(--violet)"/><path d="M26 45 L39 58 L63 32" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="60" stroke-dashoffset="60"/></svg>
          <div style="font-family:'Inter Display';font-weight:700;font-size:58px;letter-spacing:-.01em">${esc(text)}</div>`;
        list.appendChild(row);
        return row;
      });
      node.appendChild(list);
      return {
        node,
        update(t) {
          revealWords(head.words, t, 0.05, 0.08);
          rows.forEach((row, i) => {
            const s = 0.55 + i * 0.42;
            const rp = prog(t, s, 0.5, ease.outQuint);
            row.style.opacity = String(prog(t, s, 0.2));
            row.style.transform = `translateX(${(1 - rp) * 60}px)`;
            row.querySelector("path").style.strokeDashoffset = String(60 * (1 - prog(t, s + 0.15, 0.35, ease.out)));
            row.querySelector("svg").style.transform = `scale(${prog(t, s, 0.4, ease.back)})`;
          });
        },
      };
    },
  });

  // 13. Screen — a tutorial step: step counter, title and an app screenshot with a highlight.
  R("screen", {
    duration: 3.2,
    bg: "black",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      node.appendChild(el("div", "glow-arc"));
      const step = labelNode(p.step ? `шаг ${p.step}` : "шаг 01 / 08", { position: "absolute", left: "86px", top: "250px", color: "var(--violet)", fontSize: "26px" });
      const title = kinetic(p.title || "Главная", "display black", { position: "absolute", left: "80px", right: "80px", top: "300px", fontSize: px(headlineSize(p.title || "Главная", 130)) });
      const sub = p.subtitle ? labelNode(p.subtitle, { position: "absolute", left: "86px", top: "450px", color: "#8d8d8d", fontSize: "24px" }) : null;
      node.append(step, title.block);
      if (sub) node.appendChild(sub);
      const frame = el("div", null, { position: "absolute", left: "70px", right: "70px", top: "560px", height: "940px", borderRadius: "36px", overflow: "hidden", border: "2px solid #2c2c2c", background: "#151515", boxShadow: "0 40px 120px rgba(0,0,0,.6)" });
      const shot = el("div", null, { position: "absolute", inset: "0", transformOrigin: "50% 30%" });
      if (p.image) {
        shot.innerHTML = `<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover;object-position:top" />`;
      } else {
        // A neutral app skeleton when there is no screenshot yet.
        shot.innerHTML = `<div style="position:absolute;left:0;top:0;bottom:0;width:190px;background:#1c1c1c;border-right:1px solid #262626"></div>
          ${[0, 1, 2, 3, 4].map((i) => `<div style="position:absolute;left:34px;top:${60 + i * 70}px;width:120px;height:22px;border-radius:8px;background:${i === 1 ? "var(--violet)" : "#2c2c2c"}"></div>`).join("")}
          <div style="position:absolute;left:230px;right:40px;top:60px;height:60px;border-radius:14px;background:#262626"></div>
          ${[0, 1, 2].map((i) => `<div style="position:absolute;left:${230 + i * 230}px;top:160px;width:200px;height:170px;border-radius:20px;background:#202020;border:1px solid #2a2a2a"></div>`).join("")}
          <div style="position:absolute;left:230px;right:40px;top:370px;bottom:40px;border-radius:20px;background:#1d1d1d;border:1px solid #262626"></div>`;
      }
      frame.appendChild(shot);
      const hl = p.highlight || { x: 25, y: 14, w: 60, h: 18 };
      const box = el("div", null, { position: "absolute", left: `${hl.x}%`, top: `${hl.y}%`, width: `${hl.w}%`, height: `${hl.h}%`, borderRadius: "18px", border: "4px solid var(--violet)", boxShadow: "0 0 0 2000px rgba(0,0,0,.45), 0 0 40px rgba(136,83,253,.7)" });
      const note = p.note ? el("div", "pill", { position: "absolute", left: `${hl.x}%`, top: `calc(${hl.y + hl.h}% + 18px)`, padding: "14px 26px", background: "var(--violet)", color: "#fff", fontSize: "28px" }, esc(p.note)) : null;
      frame.appendChild(box);
      if (note) frame.appendChild(note);
      node.appendChild(frame);
      return {
        node,
        update(t, dur) {
          step.style.opacity = String(prog(t, 0, 0.3));
          revealWords(title.words, t, 0.05, 0.08);
          if (sub) sub.style.opacity = String(prog(t, 0.3, 0.3));
          const fp = prog(t, 0.25, 0.8, ease.outQuint);
          frame.style.opacity = String(fp);
          frame.style.transform = `translateY(${(1 - fp) * 80}px) scale(${lerp(0.94, 1, fp)})`;
          shot.style.transform = `scale(${1 + 0.06 * prog(t, 0.6, dur, ease.inOut)})`;
          const bp = prog(t, 1.0, 0.5, ease.back);
          box.style.opacity = String(prog(t, 1.0, 0.2));
          box.style.transform = `scale(${lerp(1.15, 1, bp)})`;
          if (note) note.style.transform = `scale(${prog(t, 1.35, 0.4, ease.back)})`;
        },
      };
    },
  });

  // 14. Outro — the brand name lands letter by letter, with a call to action.
  R("outro", {
    duration: 2.6,
    bg: "violet",
    build(p) {
      const node = el("div", null, { position: "absolute", inset: "0" });
      const name = String(p.brand || "ИИнна");
      const wrap = el("div", "display black", { position: "absolute", left: "0", right: "0", top: "640px", textAlign: "center", fontSize: px(Math.min(260, 900 / (name.length * 0.62))), textTransform: "none", letterSpacing: "-0.04em", whiteSpace: "nowrap" });
      const letters = Array.from(name).map((ch) => {
        const s = el("span", "word", null, esc(ch));
        wrap.appendChild(s);
        return s;
      });
      const dot = el("span", "word", { color: p.bg === "violet" || !p.bg ? "var(--ink)" : "var(--violet)" }, ".");
      wrap.appendChild(dot);
      node.appendChild(wrap);
      const line = p.line ? labelNode(p.line, { position: "absolute", left: "0", right: "0", textAlign: "center", top: "960px", fontSize: "30px", opacity: "0.85" }) : null;
      if (line) node.appendChild(line);
      const cta = el("div", "pill", { position: "absolute", left: "50%", top: "1080px", padding: "34px 64px", fontSize: "44px", background: p.bg === "cream" ? "var(--ink)" : "#fff", color: p.bg === "cream" ? "#fff" : "var(--ink)", transform: "translateX(-50%)", whiteSpace: "nowrap" }, esc(p.cta || "Ссылка в профиле"));
      node.appendChild(cta);
      return {
        node,
        update(t) {
          fitText(wrap, 940);
          letters.concat(dot).forEach((s, i) => {
            const lp = prog(t, 0.05 + i * 0.06, 0.55, ease.back);
            s.style.transform = `translateY(${(1 - lp) * 140}px)`;
            s.style.opacity = String(clamp((t - 0.05 - i * 0.06) / 0.12));
          });
          if (line) line.style.opacity = String(prog(t, 0.6, 0.4) * 0.85);
          const cp = prog(t, 0.8, 0.6, ease.spring);
          cta.style.opacity = String(prog(t, 0.8, 0.15));
          cta.style.transform = `translateX(-50%) translateY(${(1 - cp) * 40}px) scale(${lerp(0.85, 1, cp)})`;
        },
      };
    },
  });
})();
