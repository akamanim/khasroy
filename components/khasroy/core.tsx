"use client";

import { useEffect, useRef } from "react";

export type CoreEvolution = {
  level: number;
  skills: number;
  knowledge: number;
  testsPassed: number;
  capabilities: {
    intelligence: number;
    security: number;
    code: number;
    memory: number;
    internet: number;
    vision: number;
    voice: number;
    agents: number;
    images: number;
  };
};

const BASE_EVOLUTION: CoreEvolution = {
  level: 1,
  skills: 0,
  knowledge: 0,
  testsPassed: 0,
  capabilities: {
    intelligence: 0,
    security: 0,
    code: 0,
    memory: 0,
    internet: 0,
    vision: 0,
    voice: 0,
    agents: 0,
    images: 0,
  },
};

export type CoreState = "idle" | "listening" | "thinking" | "responding";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function smooth(current: number, target: number, dt: number, tau: number) {
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export function Core({
  state,
  evolution = BASE_EVOLUTION,
}: {
  state: CoreState;
  evolution?: CoreEvolution;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(state);
  const progress = useRef(evolution);

  useEffect(() => {
    current.current = state;
  }, [state]);

  useEffect(() => {
    progress.current = evolution;
  }, [evolution]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const context = element.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    let frame = 0;
    let width = 0;
    let height = 0;
    let last = performance.now();
    let spin = 0;
    let reverseSpin = 0;
    let energy = 0.18;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(() => {
      width = element.clientWidth;
      height = element.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      element.width = Math.max(1, Math.floor(width * dpr));
      element.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    resize.observe(element);

    const shellPoints = Array.from({ length: 1650 }, (_, index) => {
      const y = 1 - (index / 1649) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = index * Math.PI * (3 - Math.sqrt(5));
      return {
        x: Math.cos(phi) * ring,
        y,
        z: Math.sin(phi) * ring,
        seed: seeded(index, 2),
      };
    });

    const filaments = Array.from({ length: 118 }, (_, index) => ({
      rot: seeded(index, 10) * Math.PI * 2,
      tilt: (seeded(index, 11) - 0.5) * 2.5,
      rx: 0.18 + seeded(index, 12) * 0.92,
      ry: 0.04 + seeded(index, 13) * 0.4,
      start: seeded(index, 14) * Math.PI * 2,
      span: 0.12 + seeded(index, 15) * 1.5,
      speed: (0.25 + seeded(index, 16) * 2.1) * (index % 2 ? -1 : 1),
      alpha: 0.06 + seeded(index, 17) * 0.2,
      width: 0.35 + seeded(index, 18) * 0.95,
      wobble: seeded(index, 19) * Math.PI * 2,
    }));

    const ribbons = Array.from({ length: 26 }, (_, index) => ({
      rot: seeded(index, 31) * Math.PI * 2,
      radius: 0.26 + seeded(index, 32) * 0.92,
      squash: 0.09 + seeded(index, 33) * 0.38,
      span: 0.55 + seeded(index, 34) * 2.15,
      phase: seeded(index, 35) * Math.PI * 2,
      speed: (0.35 + seeded(index, 36) * 1.4) * (index % 2 ? -1 : 1),
    }));

    function drawBackdrop(cx: number, cy: number, radius: number, time: number) {
      const breath = reduced.matches ? 1 : 1 + Math.sin(time * 0.00155) * 0.045;
      const glowRadius = radius * (1.5 + energy * 0.3) * breath;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      glow.addColorStop(0, `rgba(255,214,108,${0.13 + energy * 0.16})`);
      glow.addColorStop(0.2, `rgba(255,142,28,${0.1 + energy * 0.11})`);
      glow.addColorStop(0.53, `rgba(170,59,5,${0.045 + energy * 0.055})`);
      glow.addColorStop(1, "rgba(30,8,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    function organicRadius(theta: number, time: number, layer: number) {
      const motion = reduced.matches ? 0 : time * 0.00055;
      return (
        1 +
        Math.sin(theta * 3 + motion * (0.65 + layer * 0.07) + layer) * 0.12 +
        Math.sin(theta * 5 - motion * 0.42 + layer * 1.7) * 0.055 +
        Math.cos(theta * 2 + motion * 0.31) * 0.035
      );
    }

    function drawNucleus(cx: number, cy: number, radius: number, time: number) {
      const breath = reduced.matches
        ? 1
        : 1 + Math.sin(time * 0.0022) * 0.06 + Math.sin(time * 0.00073) * 0.035;
      const nucleus = radius * (0.21 + energy * 0.035) * breath;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let layer = 4; layer >= 0; layer -= 1) {
        const layerRadius = nucleus * (0.72 + layer * 0.18);
        const rotation = reverseSpin * (0.42 + layer * 0.09) * (layer % 2 ? -1 : 1);
        ctx.save();
        ctx.rotate(rotation + layer * 0.4);
        ctx.beginPath();
        for (let i = 0; i <= 96; i += 1) {
          const theta = (i / 96) * Math.PI * 2;
          const rr = layerRadius * organicRadius(theta, time, layer);
          const x = Math.cos(theta) * rr;
          const y = Math.sin(theta) * rr * (0.76 + layer * 0.02);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = layer === 0
          ? `rgba(255,247,195,${0.38 + energy * 0.38})`
          : `rgba(255,149,31,${0.1 + energy * 0.1 + layer * 0.025})`;
        ctx.lineWidth = layer === 0 ? 1.25 : 0.65;
        ctx.stroke();
        ctx.restore();
      }

      const coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, nucleus * 2.5);
      coreGlow.addColorStop(0, `rgba(255,255,221,${0.72 + energy * 0.22})`);
      coreGlow.addColorStop(0.14, `rgba(255,226,126,${0.58 + energy * 0.24})`);
      coreGlow.addColorStop(0.42, `rgba(255,143,24,${0.22 + energy * 0.18})`);
      coreGlow.addColorStop(1, "rgba(255,70,0,0)");
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(0, 0, nucleus * 2.5, 0, Math.PI * 2);
      ctx.fill();

      for (let index = 0; index < 20; index += 1) {
        const a = (index / 20) * Math.PI * 2 + spin * 1.8;
        const inner = nucleus * (0.2 + (index % 3) * 0.1);
        const outer = nucleus * (0.82 + (index % 5) * 0.11);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner * 0.78);
        ctx.quadraticCurveTo(
          Math.cos(a + 0.35) * outer * 0.58,
          Math.sin(a - 0.2) * outer * 0.4,
          Math.cos(a + 0.18) * outer,
          Math.sin(a + 0.18) * outer * 0.78,
        );
        ctx.strokeStyle = `rgba(255,225,137,${0.12 + energy * 0.24})`;
        ctx.lineWidth = index % 4 === 0 ? 1.2 : 0.55;
        ctx.stroke();
      }

      ctx.restore();
    }

    function drawShell(cx: number, cy: number, radius: number, time: number) {
      const breath = reduced.matches
        ? 1
        : 1 + Math.sin(time * 0.00155) * 0.04 + Math.sin(time * 0.00043) * 0.02;
      const tilt = 0.31 + Math.sin(time * 0.00021) * 0.07;
      const shellSpin = spin * 0.76;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      for (const point of shellPoints) {
        const x1 = point.x * Math.cos(shellSpin) - point.z * Math.sin(shellSpin);
        const z1 = point.x * Math.sin(shellSpin) + point.z * Math.cos(shellSpin);
        const y1 = point.y;
        const y2 = y1 * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y1 * Math.sin(tilt) + z1 * Math.cos(tilt);

        const longitude = Math.atan2(z1, x1);
        const latitude = Math.asin(clamp(y1, -1, 1));
        const livingDistortion = reduced.matches
          ? 1
          : 1 +
            Math.sin(longitude * 3 + time * 0.00072 + point.seed * 3) * 0.095 +
            Math.cos(latitude * 5 - time * 0.00053 + point.seed * 5) * 0.055 +
            Math.sin((x1 + y1) * 6 + time * 0.0009) * 0.025 * energy;

        const sideBias = 1 + 0.055 * Math.sin(longitude + 0.9) - 0.035 * y1;
        const rx = livingDistortion * sideBias * breath;
        const perspective = 2.85 / (3.05 - z2 * 0.5);
        const px = cx + x1 * radius * 1.08 * perspective * rx;
        const py = cy + y2 * radius * 0.9 * perspective * rx;
        const depth = (z2 + 1) / 2;
        const flicker = reduced.matches
          ? 1
          : 0.7 + Math.sin(time * 0.0042 + point.seed * 31) * 0.3;
        const alpha = clamp((0.055 + depth * 0.32) * flicker * (0.78 + energy * 0.65), 0.025, 0.6);

        ctx.fillStyle = depth > 0.68
          ? `rgba(255,194,91,${alpha})`
          : `rgba(224,96,12,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 0.28 + depth * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawFilaments(cx: number, cy: number, radius: number, time: number) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (const filament of filaments) {
        const drift = reduced.matches ? 0 : time * 0.00005 * filament.speed * (0.7 + energy * 2.15);
        const wobble = reduced.matches ? 0 : Math.sin(time * 0.0012 + filament.wobble) * 0.05;
        ctx.save();
        ctx.rotate(filament.rot + drift + spin * 0.12);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * filament.rx * (1 + wobble),
          radius * filament.ry * (1 - wobble * 0.6),
          filament.tilt + wobble,
          filament.start + drift,
          filament.start + filament.span + drift,
        );
        ctx.strokeStyle = `rgba(255,139,25,${Math.min(0.5, filament.alpha * (0.75 + energy * 1.5))})`;
        ctx.lineWidth = filament.width * (0.85 + energy * 0.3);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    function drawRibbons(cx: number, cy: number, radius: number, time: number) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < ribbons.length; index += 1) {
        const ribbon = ribbons[index];
        const drift = reduced.matches ? 0 : time * 0.000045 * ribbon.speed * (0.8 + energy * 1.8);
        ctx.save();
        ctx.rotate(ribbon.rot + drift + reverseSpin * 0.1);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * ribbon.radius,
          radius * ribbon.radius * ribbon.squash,
          ribbon.phase * 0.3,
          ribbon.phase + drift,
          ribbon.phase + ribbon.span + drift,
        );
        ctx.strokeStyle = index % 4 === 0
          ? `rgba(255,232,157,${0.13 + energy * 0.35})`
          : `rgba(255,122,17,${0.09 + energy * 0.22})`;
        ctx.lineWidth = index % 5 === 0 ? 1.4 : 0.65;
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    function drawEvolution(cx: number, cy: number, radius: number, time: number) {
      const e = progress.current;
      const detailCount = clamp(10 + e.level * 3 + e.skills * 2, 10, 72);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < detailCount; index += 1) {
        const lane = index % 7;
        const ringRadius = radius * (1.03 + lane * 0.038);
        const direction = index % 2 ? -1 : 1;
        const drift = reduced.matches ? 0 : time * 0.000035 * direction * (0.7 + energy * 1.8);
        const start = (index / detailCount) * Math.PI * 2 + lane * 0.37 + drift;
        const span = 0.035 + (index % 6) * 0.032;
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, start, start + span);
        ctx.strokeStyle = `rgba(255,133,28,${0.15 + energy * 0.28})`;
        ctx.lineWidth = index % 7 === 0 ? 1.3 : 0.55;
        ctx.stroke();
      }

      if (e.capabilities.security > 0) {
        ctx.save();
        ctx.setLineDash([6, 11]);
        ctx.lineDashOffset = reduced.matches ? 0 : -time * 0.009 * (0.55 + energy);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.31, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,124,25,${0.12 + energy * 0.2})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }

      const codeNodes = clamp(e.capabilities.code * 8, 0, 40);
      for (let index = 0; index < codeNodes; index += 1) {
        const a = (index / Math.max(1, codeNodes)) * Math.PI * 2 + reverseSpin * 0.22;
        const rr = radius * (0.83 + (index % 4) * 0.075);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.68;
        ctx.strokeStyle = `rgba(255,189,82,${0.16 + energy * 0.28})`;
        ctx.strokeRect(x - 2, y - 2, 4, 4);
      }

      if (e.capabilities.memory > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.47, radius * 0.31, -0.35 + spin * 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,211,119,${0.12 + energy * 0.24})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      if (e.capabilities.internet > 0) {
        for (let index = 0; index < 3; index += 1) {
          const a = -0.55 + index * 1.7 + spin * 0.08;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8);
          ctx.lineTo(Math.cos(a) * radius * 1.48, Math.sin(a) * radius * 1.48);
          ctx.strokeStyle = `rgba(255,163,55,${0.08 + energy * 0.2})`;
          ctx.stroke();
        }
      }

      if (e.capabilities.vision > 0 || e.capabilities.images > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.28, radius * 0.12, spin * 0.18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,239,183,${0.2 + energy * 0.28})`;
        ctx.stroke();
      }

      if (e.capabilities.voice > 0) {
        for (let index = 0; index < 3; index += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, radius * (1.37 + index * 0.065), -0.42, 0.42);
          ctx.strokeStyle = `rgba(255,145,36,${0.15 - index * 0.03 + energy * 0.08})`;
          ctx.stroke();
        }
      }

      if (e.capabilities.agents > 0) {
        const satellites = clamp(e.capabilities.agents * 3, 0, 12);
        for (let index = 0; index < satellites; index += 1) {
          const a = (index / satellites) * Math.PI * 2 + spin * 0.4;
          const rr = radius * 1.18;
          ctx.fillStyle = `rgba(255,226,142,${0.4 + energy * 0.35})`;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    function draw(time: number) {
      const dt = Math.min(50, Math.max(0, time - last));
      last = time;

      const target = reduced.matches
        ? 0.12
        : current.current === "thinking"
          ? 1
          : current.current === "responding"
            ? 0.72
            : current.current === "listening"
              ? 0.42
              : 0.18;

      const tau = target > energy ? 180 : 1450;
      energy = smooth(energy, target, dt, tau);

      if (!reduced.matches) {
        spin += dt * (0.00008 + energy * 0.00042);
        reverseSpin -= dt * (0.000055 + energy * 0.00027);
      }

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * (0.295 + energy * 0.006);

      drawBackdrop(cx, cy, radius, time);
      drawShell(cx, cy, radius, time);
      drawFilaments(cx, cy, radius, time);
      drawRibbons(cx, cy, radius, time);
      drawNucleus(cx, cy, radius, time);
      drawEvolution(cx, cy, radius, time);

      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      className={`core-canvas ${state}`}
      role="img"
      aria-label={
        state === "thinking"
          ? `AI-ядро Хасроя уровня ${evolution.level} обрабатывает сообщение`
          : state === "responding"
            ? `AI-ядро Хасроя уровня ${evolution.level} отвечает`
            : `AI-ядро Хасроя, уровень развития ${evolution.level}`
      }
    />
  );
}
