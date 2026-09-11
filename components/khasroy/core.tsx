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

function smoothStep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
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

    const shellPointCount = 2350;
    const shellPoints = Array.from({ length: shellPointCount }, (_, index) => {
      const y = 1 - (index / (shellPointCount - 1)) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = index * Math.PI * (3 - Math.sqrt(5));
      return {
        x: Math.cos(phi) * ring,
        y,
        z: Math.sin(phi) * ring,
        seed: seeded(index, 2),
      };
    });

    const haloPoints = Array.from({ length: 760 }, (_, index) => ({
      angle: seeded(index, 41) * Math.PI * 2,
      radius: 1.04 + seeded(index, 42) * 0.68,
      squash: 0.62 + seeded(index, 43) * 0.36,
      speed: (0.16 + seeded(index, 44) * 0.65) * (index % 2 ? -1 : 1),
      phase: seeded(index, 45) * Math.PI * 2,
      size: 0.35 + seeded(index, 46) * 1.15,
      alpha: 0.08 + seeded(index, 47) * 0.34,
    }));

    const longFilaments = Array.from({ length: 24 }, (_, index) => ({
      rot: seeded(index, 10) * Math.PI * 2,
      tilt: (seeded(index, 11) - 0.5) * 1.9,
      radius: 0.72 + seeded(index, 12) * 0.63,
      squash: 0.14 + seeded(index, 13) * 0.28,
      start: seeded(index, 14) * Math.PI * 2,
      span: 1.35 + seeded(index, 15) * 2.75,
      speed: (0.24 + seeded(index, 16) * 1.25) * (index % 2 ? -1 : 1),
      alpha: 0.12 + seeded(index, 17) * 0.24,
      width: 0.8 + seeded(index, 18) * 0.95,
      wobble: seeded(index, 19) * Math.PI * 2,
    }));

    const orbits = Array.from({ length: 8 }, (_, index) => ({
      radius: 1.08 + index * 0.065 + seeded(index, 51) * 0.07,
      squash: 0.2 + seeded(index, 52) * 0.32,
      tilt: -0.78 + seeded(index, 53) * 1.56,
      phase: seeded(index, 54) * Math.PI * 2,
      speed: (0.12 + seeded(index, 55) * 0.42) * (index % 2 ? -1 : 1),
      width: index % 3 === 0 ? 1.8 : 1.05,
      alpha: 0.12 + seeded(index, 56) * 0.2,
    }));

    const braids = Array.from({ length: 3 }, (_, index) => ({
      phase: (index / 3) * Math.PI * 2 + seeded(index, 61) * 0.45,
      speed: (0.16 + seeded(index, 62) * 0.2) * (index % 2 ? -1 : 1),
      turns: 1.38 + seeded(index, 63) * 0.42,
      flatten: 0.42 + seeded(index, 64) * 0.13,
      reach: 1.18 + seeded(index, 65) * 0.2,
    }));

    function drawBackdrop(cx: number, cy: number, radius: number, time: number) {
      const breath = reduced.matches ? 1 : 1 + Math.sin(time * 0.00155) * 0.045;
      const glowRadius = radius * (1.72 + energy * 0.34) * breath;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      glow.addColorStop(0, `rgba(255,214,108,${0.14 + energy * 0.17})`);
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
        Math.sin(theta * 3 + motion * (0.65 + layer * 0.07) + layer) * 0.105 +
        Math.sin(theta * 5 - motion * 0.42 + layer * 1.7) * 0.045 +
        Math.cos(theta * 2 + motion * 0.31) * 0.03
      );
    }

    function drawNucleus(cx: number, cy: number, radius: number, time: number) {
      const breath = reduced.matches
        ? 1
        : 1 + Math.sin(time * 0.0022) * 0.06 + Math.sin(time * 0.00073) * 0.035;
      const nucleus = radius * (0.205 + energy * 0.03) * breath;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let layer = 2; layer >= 0; layer -= 1) {
        const layerRadius = nucleus * (0.86 + layer * 0.2);
        const rotation = reverseSpin * (0.34 + layer * 0.08) * (layer % 2 ? -1 : 1);
        ctx.save();
        ctx.rotate(rotation + layer * 0.54);
        ctx.beginPath();
        for (let i = 0; i <= 112; i += 1) {
          const theta = (i / 112) * Math.PI * 2;
          const rr = layerRadius * organicRadius(theta, time, layer);
          const x = Math.cos(theta) * rr;
          const y = Math.sin(theta) * rr * (0.77 + layer * 0.025);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = layer === 0
          ? `rgba(255,247,195,${0.46 + energy * 0.35})`
          : `rgba(255,153,36,${0.16 + energy * 0.13 + layer * 0.035})`;
        ctx.lineWidth = layer === 0 ? 1.55 : 1.05;
        ctx.stroke();
        ctx.restore();
      }

      const coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, nucleus * 2.65);
      coreGlow.addColorStop(0, `rgba(255,255,221,${0.72 + energy * 0.22})`);
      coreGlow.addColorStop(0.14, `rgba(255,226,126,${0.58 + energy * 0.24})`);
      coreGlow.addColorStop(0.42, `rgba(255,143,24,${0.22 + energy * 0.18})`);
      coreGlow.addColorStop(1, "rgba(255,70,0,0)");
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(0, 0, nucleus * 2.65, 0, Math.PI * 2);
      ctx.fill();

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
            Math.sin(longitude * 3 + time * 0.00072 + point.seed * 3) * 0.09 +
            Math.cos(latitude * 5 - time * 0.00053 + point.seed * 5) * 0.05 +
            Math.sin((x1 + y1) * 6 + time * 0.0009) * 0.022 * energy;

        const sideBias = 1 + 0.05 * Math.sin(longitude + 0.9) - 0.03 * y1;
        const rx = livingDistortion * sideBias * breath;
        const perspective = 2.85 / (3.05 - z2 * 0.5);
        const px = cx + x1 * radius * 1.08 * perspective * rx;
        const py = cy + y2 * radius * 0.9 * perspective * rx;
        const depth = (z2 + 1) / 2;
        const flicker = reduced.matches
          ? 1
          : 0.74 + Math.sin(time * 0.0042 + point.seed * 31) * 0.26;
        const alpha = clamp((0.05 + depth * 0.34) * flicker * (0.8 + energy * 0.68), 0.025, 0.64);

        ctx.fillStyle = depth > 0.68
          ? `rgba(255,203,108,${alpha})`
          : `rgba(224,96,12,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 0.3 + depth * 0.68, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawHaloParticles(cx: number, cy: number, radius: number, time: number) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (const point of haloPoints) {
        const drift = reduced.matches ? 0 : time * 0.000045 * point.speed * (0.7 + energy * 1.25);
        const a = point.angle + point.phase * 0.1 + drift + spin * 0.09;
        const pulse = reduced.matches ? 1 : 1 + Math.sin(time * 0.0018 + point.phase) * 0.055;
        const rr = radius * point.radius * pulse;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * point.squash;
        const shimmer = reduced.matches ? 1 : 0.72 + Math.sin(time * 0.003 + point.phase * 4) * 0.28;
        const alpha = clamp(point.alpha * shimmer * (0.68 + energy * 0.9), 0.035, 0.62);

        ctx.fillStyle = point.radius > 1.42
          ? `rgba(255,137,30,${alpha})`
          : `rgba(255,208,119,${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, point.size * (0.86 + energy * 0.26), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawLongFilaments(cx: number, cy: number, radius: number, time: number) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (const filament of longFilaments) {
        const drift = reduced.matches ? 0 : time * 0.00005 * filament.speed * (0.7 + energy * 1.7);
        const wobble = reduced.matches ? 0 : Math.sin(time * 0.001 + filament.wobble) * 0.035;
        ctx.save();
        ctx.rotate(filament.rot + drift + spin * 0.11);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * filament.radius * (1 + wobble),
          radius * filament.radius * filament.squash * (1 - wobble * 0.45),
          filament.tilt + wobble,
          filament.start + drift,
          filament.start + filament.span + drift,
        );
        ctx.strokeStyle = `rgba(255,145,32,${Math.min(0.58, filament.alpha * (0.82 + energy * 1.45))})`;
        ctx.lineWidth = filament.width * (0.95 + energy * 0.24);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    function drawOrbits(cx: number, cy: number, radius: number, time: number, front: boolean) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < orbits.length; index += 1) {
        if ((index % 2 === 0) !== front) continue;
        const orbit = orbits[index];
        const drift = reduced.matches ? 0 : time * 0.00012 * orbit.speed * (0.7 + energy * 1.2);
        ctx.save();
        ctx.rotate(orbit.tilt + drift * 0.23 + reverseSpin * 0.08);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * orbit.radius,
          radius * orbit.radius * orbit.squash,
          orbit.phase * 0.16,
          orbit.phase + drift,
          orbit.phase + Math.PI * 1.72 + drift,
        );
        ctx.strokeStyle = index % 3 === 0
          ? `rgba(255,235,169,${orbit.alpha + energy * 0.27})`
          : `rgba(255,127,22,${orbit.alpha + energy * 0.2})`;
        ctx.lineWidth = orbit.width * (0.96 + energy * 0.2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    function drawBraids(cx: number, cy: number, radius: number, time: number) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let bundleIndex = 0; bundleIndex < braids.length; bundleIndex += 1) {
        const braid = braids[bundleIndex];
        const rotation = reduced.matches
          ? braid.phase
          : braid.phase + time * 0.00017 * braid.speed * (0.75 + energy * 1.8) + spin * 0.18;

        for (let strand = 0; strand < 3; strand += 1) {
          const strandPhase = (strand / 3) * Math.PI * 2;
          ctx.beginPath();

          for (let step = 0; step <= 92; step += 1) {
            const t = step / 92;
            const eased = smoothStep(t);
            const angle = rotation + eased * Math.PI * 2 * braid.turns;
            const rr = radius * (0.17 + eased * braid.reach);
            const weave = Math.sin(t * Math.PI * 13 + strandPhase + rotation * 2.1)
              * radius
              * (0.008 + eased * 0.024);
            const x = Math.cos(angle) * rr + Math.cos(angle + Math.PI / 2) * weave;
            const y = Math.sin(angle) * rr * braid.flatten
              + Math.sin(angle + Math.PI / 2) * weave * 0.7;

            if (step === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }

          const frontStrand = strand === ((Math.floor(time / 850) + bundleIndex) % 3);
          ctx.strokeStyle = frontStrand
            ? `rgba(255,240,179,${0.28 + energy * 0.36})`
            : `rgba(255,128,25,${0.18 + energy * 0.27})`;
          ctx.lineWidth = frontStrand ? 1.7 : 1.1;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    function drawEvolution(cx: number, cy: number, radius: number, time: number) {
      const e = progress.current;
      const detailCount = clamp(6 + e.level * 2 + e.skills, 6, 24);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < detailCount; index += 1) {
        const lane = index % 5;
        const ringRadius = radius * (1.05 + lane * 0.055);
        const direction = index % 2 ? -1 : 1;
        const drift = reduced.matches ? 0 : time * 0.000035 * direction * (0.7 + energy * 1.5);
        const start = (index / detailCount) * Math.PI * 2 + lane * 0.37 + drift;
        const span = 0.28 + (index % 5) * 0.11;
        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, start, start + span);
        ctx.strokeStyle = `rgba(255,139,34,${0.13 + energy * 0.25})`;
        ctx.lineWidth = index % 5 === 0 ? 1.55 : 0.95;
        ctx.stroke();
      }

      if (e.capabilities.security > 0) {
        ctx.save();
        ctx.setLineDash([11, 17]);
        ctx.lineDashOffset = reduced.matches ? 0 : -time * 0.007 * (0.55 + energy);
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.38, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,137,31,${0.13 + energy * 0.2})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      }

      const codeNodes = clamp(e.capabilities.code * 7, 0, 35);
      for (let index = 0; index < codeNodes; index += 1) {
        const a = (index / Math.max(1, codeNodes)) * Math.PI * 2 + reverseSpin * 0.22;
        const rr = radius * (0.86 + (index % 4) * 0.085);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.69;
        ctx.strokeStyle = `rgba(255,196,91,${0.17 + energy * 0.27})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2, y - 2, 4, 4);
      }

      if (e.capabilities.memory > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.49, radius * 0.3, -0.35 + spin * 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,218,132,${0.13 + energy * 0.24})`;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      if (e.capabilities.internet > 0) {
        for (let index = 0; index < 3; index += 1) {
          const a = -0.75 + index * 2.1 + spin * 0.08;
          ctx.beginPath();
          ctx.arc(0, 0, radius * (1.46 + index * 0.055), a, a + 0.62);
          ctx.strokeStyle = `rgba(255,169,64,${0.11 + energy * 0.2})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      if (e.capabilities.vision > 0 || e.capabilities.images > 0) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.3, radius * 0.13, spin * 0.18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,242,194,${0.22 + energy * 0.28})`;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      if (e.capabilities.voice > 0) {
        for (let index = 0; index < 3; index += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, radius * (1.52 + index * 0.075), -0.48, 0.48);
          ctx.strokeStyle = `rgba(255,151,42,${0.16 - index * 0.03 + energy * 0.08})`;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
      }

      if (e.capabilities.agents > 0) {
        const satellites = clamp(e.capabilities.agents * 3, 0, 12);
        for (let index = 0; index < satellites; index += 1) {
          const a = (index / satellites) * Math.PI * 2 + spin * 0.4;
          const rr = radius * 1.23;
          ctx.fillStyle = `rgba(255,229,151,${0.42 + energy * 0.34})`;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.8, 0, Math.PI * 2);
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
      const radius = Math.min(width, height) * (0.292 + energy * 0.006);

      drawBackdrop(cx, cy, radius, time);
      drawHaloParticles(cx, cy, radius, time);
      drawOrbits(cx, cy, radius, time, false);
      drawShell(cx, cy, radius, time);
      drawLongFilaments(cx, cy, radius, time);
      drawBraids(cx, cy, radius, time);
      drawNucleus(cx, cy, radius, time);
      drawOrbits(cx, cy, radius, time, true);
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
