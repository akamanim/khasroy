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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

export function Core({
  state,
  evolution = BASE_EVOLUTION,
}: {
  state: "idle" | "listening" | "thinking";
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
    let spin = 0;
    let counterSpin = 0;
    let width = 0;
    let height = 0;
    let last = 0;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(() => {
      width = element.clientWidth;
      height = element.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      element.width = width * dpr;
      element.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    resize.observe(element);

    const shellPoints = Array.from({ length: 1450 }, (_, index) => {
      const y = 1 - (index / 1449) * 2;
      const ring = Math.sqrt(1 - y * y);
      const phi = index * Math.PI * (3 - Math.sqrt(5));
      return {
        x: Math.cos(phi) * ring,
        y,
        z: Math.sin(phi) * ring,
        spark: seeded(index, 2),
      };
    });

    const filaments = Array.from({ length: 92 }, (_, index) => ({
      rotation: seeded(index, 4) * Math.PI * 2,
      tilt: (seeded(index, 5) - 0.5) * 1.9,
      rx: 0.2 + seeded(index, 6) * 0.78,
      ry: 0.08 + seeded(index, 7) * 0.38,
      start: seeded(index, 8) * Math.PI * 2,
      length: 0.18 + seeded(index, 9) * 1.25,
      speed: (0.25 + seeded(index, 10) * 1.7) * (index % 2 === 0 ? 1 : -1),
      alpha: 0.07 + seeded(index, 11) * 0.21,
      lineWidth: 0.35 + seeded(index, 12) * 1.05,
    }));

    const orbitals = Array.from({ length: 18 }, (_, index) => ({
      radius: 0.28 + seeded(index, 20) * 0.86,
      squash: 0.18 + seeded(index, 21) * 0.5,
      rotation: seeded(index, 22) * Math.PI,
      start: seeded(index, 23) * Math.PI * 2,
      length: 0.45 + seeded(index, 24) * 1.9,
      speed: (0.3 + seeded(index, 25) * 1.5) * (index % 2 ? -1 : 1),
    }));

    function drawBackgroundGlow(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      const pulse = reduced.matches
        ? 1
        : 0.92 + Math.sin(time * (active ? 0.006 : 0.0024)) * 0.08;
      const glow = ctx.createRadialGradient(
        cx,
        cy,
        radius * 0.08,
        cx,
        cy,
        radius * 1.7,
      );
      glow.addColorStop(0, active ? "rgba(255,205,94,.34)" : "rgba(255,145,31,.22)");
      glow.addColorStop(0.35, `rgba(255,112,17,${active ? 0.15 : 0.09})`);
      glow.addColorStop(0.72, `rgba(143,48,3,${0.05 * pulse})`);
      glow.addColorStop(1, "rgba(12,4,1,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    function drawNucleus(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      const pulse = reduced.matches
        ? 1
        : 1 + Math.sin(time * (active ? 0.009 : 0.0035)) * (active ? 0.09 : 0.045);
      const nucleus = radius * 0.24 * pulse;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      const coreGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, nucleus * 2.2);
      coreGlow.addColorStop(0, active ? "rgba(255,250,191,.92)" : "rgba(255,217,115,.72)");
      coreGlow.addColorStop(0.28, active ? "rgba(255,184,44,.62)" : "rgba(255,145,24,.42)");
      coreGlow.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = coreGlow;
      ctx.beginPath();
      ctx.arc(0, 0, nucleus * 2.2, 0, Math.PI * 2);
      ctx.fill();

      for (let index = 0; index < 9; index += 1) {
        const direction = index % 2 === 0 ? 1 : -1;
        const localSpin = reduced.matches ? 0 : time * 0.0002 * direction * (index + 2);
        ctx.save();
        ctx.rotate(localSpin + index * 0.63);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          nucleus * (0.65 + index * 0.055),
          nucleus * (0.22 + (index % 3) * 0.05),
          index * 0.21,
          0.15,
          Math.PI * (1.2 + (index % 3) * 0.2),
        );
        ctx.strokeStyle = active
          ? `rgba(255,232,156,${0.34 + index * 0.025})`
          : `rgba(255,165,48,${0.2 + index * 0.018})`;
        ctx.lineWidth = index % 3 === 0 ? 1.5 : 0.75;
        ctx.stroke();
        ctx.restore();
      }

      for (let index = 0; index < 16; index += 1) {
        const a = (index / 16) * Math.PI * 2 + counterSpin * 0.8;
        const inner = nucleus * (0.35 + (index % 4) * 0.09);
        const outer = nucleus * (0.8 + (index % 5) * 0.1);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a + 0.18) * outer, Math.sin(a + 0.18) * outer);
        ctx.strokeStyle = active ? "rgba(255,238,175,.38)" : "rgba(255,135,28,.2)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      ctx.restore();
    }

    function drawFilaments(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (const filament of filaments) {
        const drift = reduced.matches
          ? 0
          : time * 0.000055 * filament.speed * (active ? 2.15 : 1);
        ctx.save();
        ctx.rotate(filament.rotation + drift + spin * 0.16);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * filament.rx,
          radius * filament.ry,
          filament.tilt,
          filament.start + drift * 0.7,
          filament.start + filament.length + drift * 0.7,
        );
        ctx.strokeStyle = active
          ? `rgba(255,202,86,${Math.min(0.48, filament.alpha * 1.65)})`
          : `rgba(255,133,27,${filament.alpha})`;
        ctx.lineWidth = filament.lineWidth;
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    function drawOrbitals(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      ctx.save();
      ctx.translate(cx, cy);

      for (let index = 0; index < orbitals.length; index += 1) {
        const orbital = orbitals[index];
        const drift = reduced.matches
          ? 0
          : time * 0.000045 * orbital.speed * (active ? 2.4 : 1);
        ctx.save();
        ctx.rotate(orbital.rotation + drift);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * orbital.radius,
          radius * orbital.radius * orbital.squash,
          index * 0.19,
          orbital.start + drift,
          orbital.start + orbital.length + drift,
        );
        ctx.strokeStyle = index % 4 === 0
          ? active
            ? "rgba(255,229,147,.58)"
            : "rgba(255,178,68,.34)"
          : active
            ? "rgba(255,167,47,.35)"
            : "rgba(214,92,12,.2)";
        ctx.lineWidth = index % 5 === 0 ? 1.35 : 0.65;
        ctx.stroke();

        if (index % 3 === 0) {
          const marker = orbital.start + orbital.length + drift;
          const mx = Math.cos(marker) * radius * orbital.radius;
          const my = Math.sin(marker) * radius * orbital.radius * orbital.squash;
          ctx.fillStyle = active ? "rgba(255,247,202,.9)" : "rgba(255,177,72,.58)";
          ctx.fillRect(mx - 1.2, my - 1.2, 2.4, 2.4);
        }
        ctx.restore();
      }

      ctx.restore();
    }

    function drawShell(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      const shellSpin = spin * 0.88;
      const tilt = 0.36 + Math.sin(time * 0.00025) * 0.04;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      for (const point of shellPoints) {
        const x1 = point.x * Math.cos(shellSpin) - point.z * Math.sin(shellSpin);
        const z1 = point.x * Math.sin(shellSpin) + point.z * Math.cos(shellSpin);
        const y2 = point.y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = point.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        const perspective = 2.9 / (3.05 - z2 * 0.46);
        const ripple = reduced.matches
          ? 1
          : 1 + Math.sin(point.y * 15 + time * 0.0017 + point.spark * 8) * (active ? 0.026 : 0.012);
        const px = cx + x1 * radius * perspective * ripple;
        const py = cy + y2 * radius * perspective * ripple;
        const depth = (z2 + 1) / 2;
        const flicker = reduced.matches
          ? 1
          : 0.74 + Math.sin(time * 0.004 + point.spark * 24) * 0.26;
        const alpha = clamp((0.08 + depth * 0.48) * flicker * (active ? 1.22 : 1), 0.05, 0.72);

        ctx.fillStyle = depth > 0.72
          ? `rgba(255,210,115,${alpha})`
          : `rgba(255,118,24,${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 0.35 + depth * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawOuterArchitecture(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      const e = progress.current;
      const detailCount = clamp(12 + e.level * 3 + e.skills * 2, 12, 64);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";

      for (let index = 0; index < detailCount; index += 1) {
        const lane = index % 6;
        const ringRadius = radius * (1.02 + lane * 0.045);
        const direction = index % 2 === 0 ? 1 : -1;
        const drift = reduced.matches ? 0 : time * 0.000035 * direction * (active ? 2.2 : 1);
        const start = (index / detailCount) * Math.PI * 2 + drift + lane * 0.31;
        const length = 0.045 + (index % 5) * 0.035;

        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, start, start + length);
        ctx.strokeStyle = active
          ? "rgba(255,199,91,.62)"
          : "rgba(244,119,26,.34)";
        ctx.lineWidth = index % 7 === 0 ? 1.45 : 0.62;
        ctx.stroke();

        if (index % 4 === 0) {
          const x = Math.cos(start + length) * ringRadius;
          const y = Math.sin(start + length) * ringRadius;
          ctx.fillStyle = active ? "rgba(255,241,187,.88)" : "rgba(255,158,55,.58)";
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }

      if (e.capabilities.security > 0) {
        ctx.save();
        ctx.setLineDash([5, 8, 2, 10]);
        ctx.lineDashOffset = reduced.matches ? 0 : -time * 0.008;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.31, 0, Math.PI * 2);
        ctx.strokeStyle = active ? "rgba(255,183,70,.48)" : "rgba(201,78,10,.26)";
        ctx.lineWidth = 0.8 + Math.min(e.capabilities.security, 4) * 0.12;
        ctx.stroke();
        ctx.restore();
      }

      const codeNodes = clamp(e.capabilities.code * 8, 0, 44);
      for (let index = 0; index < codeNodes; index += 1) {
        const a = (index / Math.max(codeNodes, 1)) * Math.PI * 2 + counterSpin * 0.6;
        const rr = radius * (0.78 + (index % 4) * 0.09);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.73;
        ctx.strokeStyle = active ? "rgba(255,220,135,.62)" : "rgba(255,142,38,.38)";
        ctx.strokeRect(x - 2.1, y - 2.1, 4.2, 4.2);
      }

      if (e.capabilities.memory > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
        ctx.strokeStyle = active ? "rgba(255,226,151,.38)" : "rgba(255,132,28,.2)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (e.capabilities.internet > 0) {
        const sweep = reduced.matches ? -0.55 : -0.55 + Math.sin(time * 0.0007) * 0.18;
        ctx.save();
        ctx.rotate(sweep);
        ctx.beginPath();
        ctx.moveTo(-radius * 1.46, 0);
        ctx.lineTo(radius * 1.46, 0);
        ctx.strokeStyle = active ? "rgba(255,213,120,.3)" : "rgba(255,117,20,.16)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }

      if (e.capabilities.vision > 0 || e.capabilities.images > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.19, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,239,185,.52)";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      if (e.capabilities.voice > 0) {
        for (let index = 0; index < 3; index += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, radius * (1.4 + index * 0.075), -0.4, 0.4);
          ctx.strokeStyle = `rgba(255,146,40,${0.22 - index * 0.05})`;
          ctx.stroke();
        }
      }

      const knowledgeRays = clamp(Math.floor(e.knowledge / 18), 0, 38);
      for (let index = 0; index < knowledgeRays; index += 1) {
        const a = (index / Math.max(knowledgeRays, 1)) * Math.PI * 2 + spin * 0.18;
        const inner = radius * 1.08;
        const outer = radius * (1.15 + (index % 5) * 0.035);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.strokeStyle = "rgba(255,126,22,.28)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      ctx.restore();
    }

    function drawScanFlash(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      if (reduced.matches) return;
      const cycle = (time * (active ? 0.00042 : 0.00013)) % 1;
      if (cycle > 0.24) return;

      const alpha = (1 - cycle / 0.24) * (active ? 0.34 : 0.12);
      const scanRadius = radius * (0.28 + cycle * 4.6);
      ctx.beginPath();
      ctx.arc(cx, cy, scanRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,216,126,${alpha})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    function draw(time: number) {
      const dt = Math.min(time - last, 50);
      last = time;
      const active = current.current === "thinking";
      const listening = current.current === "listening";

      if (!reduced.matches) {
        spin += dt * (active ? 0.00086 : listening ? 0.00038 : 0.0002);
        counterSpin -= dt * (active ? 0.00062 : 0.00014);
      }

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.31;

      drawBackgroundGlow(cx, cy, radius, time, active);
      drawFilaments(cx, cy, radius, time, active);
      drawNucleus(cx, cy, radius, time, active);
      drawOrbitals(cx, cy, radius, time, active);
      drawShell(cx, cy, radius, time, active);
      drawOuterArchitecture(cx, cy, radius, time, active);
      drawScanFlash(cx, cy, radius, time, active);

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
          : `AI-ядро Хасроя, уровень развития ${evolution.level}`
      }
    />
  );
}
