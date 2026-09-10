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
    let angle = 0;
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

    const points = Array.from({ length: 2600 }, (_, index) => {
      const y = 1 - (index / 2599) * 2;
      const radius = Math.sqrt(1 - y * y);
      const phi = index * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(phi) * radius, y, z: Math.sin(phi) * radius };
    });

    function drawEvolutionLayer(
      cx: number,
      cy: number,
      radius: number,
      time: number,
      active: boolean,
    ) {
      const e = progress.current;
      const detailCount = clamp(4 + e.level * 2 + e.skills * 2, 4, 42);

      ctx.save();
      ctx.translate(cx, cy);

      for (let index = 0; index < detailCount; index += 1) {
        const lane = index % 5;
        const ringRadius = radius * (1.03 + lane * 0.045);
        const direction = index % 2 === 0 ? 1 : -1;
        const drift = reduced.matches ? 0 : time * 0.000025 * direction;
        const start = (index / detailCount) * Math.PI * 2 + drift + lane * 0.17;
        const length = 0.07 + (index % 4) * 0.035;

        ctx.beginPath();
        ctx.arc(0, 0, ringRadius, start, start + length);
        ctx.strokeStyle = active
          ? "rgba(170,238,248,.62)"
          : "rgba(105,202,229,.38)";
        ctx.lineWidth = index % 6 === 0 ? 1.3 : 0.7;
        ctx.stroke();

        if (index % 4 === 0) {
          const nodeX = Math.cos(start + length) * ringRadius;
          const nodeY = Math.sin(start + length) * ringRadius;
          ctx.fillStyle = active
            ? "rgba(210,248,255,.82)"
            : "rgba(120,216,235,.52)";
          ctx.fillRect(nodeX - 1, nodeY - 1, 2, 2);
        }
      }

      const intelligenceRings = clamp(e.capabilities.intelligence, 0, 6);
      for (let index = 0; index < intelligenceRings; index += 1) {
        ctx.save();
        const spin = reduced.matches
          ? 0
          : time * 0.00006 * (index % 2 === 0 ? 1 : -1);
        ctx.rotate(spin + index * 0.7);
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * (0.52 + index * 0.055),
          radius * (0.17 + index * 0.02),
          index * 0.38,
          0,
          Math.PI * 1.55,
        );
        ctx.strokeStyle = active
          ? "rgba(181,241,250,.46)"
          : "rgba(99,196,220,.29)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }

      if (e.capabilities.security > 0) {
        ctx.save();
        ctx.setLineDash([7, 9]);
        ctx.lineDashOffset = reduced.matches ? 0 : -time * 0.006;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.29, 0, Math.PI * 2);
        ctx.strokeStyle = active
          ? "rgba(139,230,241,.45)"
          : "rgba(81,166,189,.27)";
        ctx.lineWidth = 0.7 + Math.min(e.capabilities.security, 4) * 0.15;
        ctx.stroke();
        ctx.restore();
      }

      const codeNodes = clamp(e.capabilities.code * 6, 0, 36);
      for (let index = 0; index < codeNodes; index += 1) {
        const a =
          (index / Math.max(codeNodes, 1)) * Math.PI * 2 + angle * 0.22;
        const rr = radius * (0.88 + (index % 3) * 0.08);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.72;
        ctx.strokeStyle = "rgba(130,220,237,.45)";
        ctx.strokeRect(x - 2.2, y - 2.2, 4.4, 4.4);
      }

      const rayCount = clamp(Math.floor(e.knowledge / 25), 0, 32);
      for (let index = 0; index < rayCount; index += 1) {
        const a = (index / rayCount) * Math.PI * 2 + angle * 0.08;
        const inner = radius * 1.1;
        const outer = radius * (1.18 + (index % 4) * 0.035);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.strokeStyle = "rgba(122,216,235,.27)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      if (e.capabilities.memory > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(149,230,242,.24)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (e.capabilities.internet > 0) {
        ctx.save();
        ctx.rotate(-0.45 + angle * 0.12);
        ctx.beginPath();
        ctx.moveTo(-radius * 1.5, 0);
        ctx.lineTo(radius * 1.5, 0);
        ctx.strokeStyle = "rgba(113,214,237,.16)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      if (e.capabilities.vision > 0 || e.capabilities.images > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(202,246,252,.42)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      if (e.capabilities.voice > 0) {
        for (let index = 0; index < 3; index += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, radius * (1.38 + index * 0.07), -0.42, 0.42);
          ctx.strokeStyle = `rgba(112,211,231,${0.18 - index * 0.04})`;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    function draw(time: number) {
      const dt = Math.min(time - last, 50);
      last = time;
      const active = current.current === "thinking";

      if (!reduced.matches) {
        angle += dt * (active ? 0.00065 : 0.00013);
      }

      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.315;
      const glow = ctx.createRadialGradient(
        cx,
        cy,
        radius * 0.2,
        cx,
        cy,
        radius * 1.65,
      );
      glow.addColorStop(0, active ? "#164c5760" : "#083e5345");
      glow.addColorStop(0.6, "#0b66882d");
      glow.addColorStop(1, "#07101800");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.3);
      for (let index = 0; index < 3; index += 1) {
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          radius * (1.15 + index * 0.1),
          radius * (0.35 + index * 0.08),
          0.25 + index * 0.55,
          angle * 0.3 + index,
          angle * 0.3 + index + Math.PI * 1.5,
        );
        ctx.strokeStyle = index === 0 ? "#72d6ec66" : "#53839830";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      ctx.restore();

      for (const point of points) {
        const x =
          point.x * Math.cos(angle) - point.z * Math.sin(angle);
        const z =
          point.x * Math.sin(angle) + point.z * Math.cos(angle);
        const y = point.y * 0.94 - z * 0.34;
        const depth = point.y * 0.34 + z * 0.94;
        const ripple = reduced.matches
          ? 1
          : 1 +
            Math.sin(point.y * 9 + angle * 5) *
              (active ? 0.055 : 0.018);
        const scale = 3 / (3 - depth * 0.4);
        ctx.fillStyle = `rgba(${active ? "154,231,244" : "98,204,239"},${0.18 + (depth + 1) * 0.36})`;
        ctx.beginPath();
        ctx.arc(
          cx + x * radius * scale * ripple,
          cy + y * radius * scale * ripple,
          0.45 + (depth + 1) * 0.48,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      drawEvolutionLayer(cx, cy, radius, time, active);
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
