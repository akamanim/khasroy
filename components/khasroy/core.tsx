"use client";

import { useEffect, useRef, useState } from "react";
import type { StormCore } from "@/components/khasroy/storm-core-engine";

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

export type CoreState = "idle" | "listening" | "thinking" | "responding";

const LABELS: Record<CoreState, string> = {
  idle: "Ядро Хасроя в покое",
  listening: "Ядро Хасроя слушает",
  thinking: "Ядро Хасроя обрабатывает сообщение",
  responding: "Ядро Хасроя отвечает",
};

/**
 * Грозовое ядро Хасроя: объёмная туча со светом изнутри и молниями.
 * Проп `evolution` оставлен для совместимости, но визуал от него больше не зависит.
 */
export function Core({ state }: { state: CoreState; evolution?: CoreEvolution }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<StormCore | null>(null);
  const latestState = useRef(state);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latestState.current = state;
    engine.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("@/components/khasroy/storm-core-engine")
      .then(({ createStormCore }) => {
        if (cancelled) return;
        const core = createStormCore(element, { reducedMotion });
        core.setState(latestState.current);
        engine.current = core;
      })
      .catch((error) => {
        console.error("Khasroy storm core failed to start", error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  return (
    <div className="core-stage">
      <canvas
        ref={canvas}
        className={`core-canvas ${state}${failed ? " core-canvas-fallback" : ""}`}
        role="img"
        aria-label={LABELS[state]}
        onPointerDown={() => engine.current?.burst()}
      />
      <Plane />
    </div>
  );
}

/**
 * A little propeller plane that lives inside the storm cloud. Most of the time it is hidden;
 * every so often it flies out, makes a loop around the cloud and dives back in.
 * Drawn here from scratch (an original design), animated with requestAnimationFrame.
 */
function Plane() {
  const group = useRef<SVGGElement>(null);

  useEffect(() => {
    const node = group.current;
    if (!node) return;
    const g: SVGGElement = node;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const FLIGHT_MS = 7000;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start = 0;
    let direction = 1;

    const hide = () => g.setAttribute("opacity", "0");
    const smooth = (x: number) => x * x * (3 - 2 * x);

    function frame(now: number) {
      const t = Math.min((now - start) / FLIGHT_MS, 1);
      // Out of the cloud, one lap around it, back in: the radius grows from the centre and
      // shrinks again at the end, so the plane spirals out and in.
      const out = smooth(Math.min(t / 0.18, 1)) * smooth(Math.min((1 - t) / 0.18, 1));
      const angle = direction * (t * Math.PI * 2.2) + Math.PI * 0.1;
      const x = 200 + Math.cos(angle) * 178 * out;
      const y = 150 + Math.sin(angle) * 72 * out - 6 * out;
      // Heading from the derivative; the plane is drawn nose-right, so mirror it when flying left.
      const dx = -Math.sin(angle) * direction;
      const dy = Math.cos(angle) * direction * (72 / 178);
      const left = dx < 0;
      // Bank at most 30°: at the ends of the loop the heading turns vertical, and a plane
      // diving nose-down there looks broken.
      const tilt = Math.max(-30, Math.min(30, (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI));
      const near = 0.75 + 0.25 * Math.sin(angle); // lower half of the loop is closer to us
      const size = (0.55 + 0.45 * out) * (0.8 + 0.3 * near);
      g.setAttribute(
        "transform",
        `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(left ? -size : size).toFixed(3)} ${size.toFixed(3)}) rotate(${(left ? -tilt : tilt).toFixed(1)})`,
      );
      g.setAttribute("opacity", (Math.min(out * 1.6, 1) * (0.7 + 0.3 * near)).toFixed(2));
      if (t < 1) raf = requestAnimationFrame(frame);
      else schedule();
    }

    function schedule(first = false) {
      hide();
      timer = setTimeout(() => {
        direction = Math.random() < 0.5 ? 1 : -1;
        start = performance.now();
        raf = requestAnimationFrame(frame);
      }, first ? 3000 : 9000 + Math.random() * 9000);
    }

    schedule(true);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <svg className="core-plane" viewBox="0 0 400 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="kh-plane-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fb4ff" />
          <stop offset="0.45" stopColor="#3d63c9" />
          <stop offset="1" stopColor="#1d2f6e" />
        </linearGradient>
        <linearGradient id="kh-plane-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9a3" />
          <stop offset="1" stopColor="#b8862b" />
        </linearGradient>
      </defs>
      <g ref={group} opacity="0">
        {/* Plane centred on (0,0), nose pointing right, about 34 units long. */}
        <path d="M -15 -1 L -19 -9 L -15.5 -9 L -10 -2 Z" fill="url(#kh-plane-body)" />
        <path d="M -16 0 L -20 3 L -13 2.5 Z" fill="#2a438f" />
        <path
          d="M -16 -1.8 C -8 -4.2 4 -4.6 11 -3.6 L 14 -2.6 L 14 2.6 L 10 3.8 C 2 4.6 -8 3.6 -16 1.6 Z"
          fill="url(#kh-plane-body)"
        />
        <path d="M 10.5 -3.7 L 14 -2.6 L 15.6 -1.2 L 15.6 1.2 L 14 2.6 L 10.5 3.8 Z" fill="url(#kh-plane-gold)" />
        <path d="M -16 1 C -6 3.2 4 3.6 10.5 3.2" stroke="#e8c46a" strokeWidth="0.6" fill="none" />
        <path d="M -2 -4.1 C 0 -7.4 4.5 -7.6 6.5 -4.4 Z" fill="#cfe6ff" stroke="#1d2f6e" strokeWidth="0.4" />
        <path d="M -3 2.4 L 5 2.6 L -1 9 L -6 9 Z" fill="url(#kh-plane-body)" stroke="#e8c46a" strokeWidth="0.4" />
        <circle cx="16.3" cy="0" r="1.1" fill="url(#kh-plane-gold)" />
        <ellipse cx="16.8" cy="0" rx="0.9" ry="8" fill="#dbe8ff" opacity="0.28">
          <animate attributeName="opacity" values="0.15;0.38;0.15" dur="0.12s" repeatCount="indefinite" />
        </ellipse>
        <rect x="16.4" y="-7.5" width="0.8" height="15" rx="0.4" fill="#2b2b33">
          <animateTransform attributeName="transform" type="scale" values="1 1;1 0.12;1 1" dur="0.09s" repeatCount="indefinite" additive="sum" />
        </rect>
      </g>
    </svg>
  );
}
