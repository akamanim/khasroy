"use client";

import { useEffect, useRef, useState } from "react";

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

export function Core({
  state,
  evolution = BASE_EVOLUTION,
}: {
  state: CoreState;
  evolution?: CoreEvolution;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ state, evolution });
  const scene = useRef<ReturnType<
    typeof import("./core-scene").createCoreScene
  > | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    current.current = { state, evolution };
    scene.current?.wake();
  }, [state, evolution]);

  useEffect(() => {
    let cancelled = false;
    const element = canvas.current;
    if (!element) return;

    const lost = (event: Event) => {
      event.preventDefault();
      scene.current?.dispose();
      scene.current = null;
      setReady(false);
    };

    async function start() {
      try {
        const { createCoreScene } = await import("./core-scene");
        if (cancelled) return;
        scene.current = createCoreScene(element!, () => current.current);
        setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    }

    element.addEventListener("webglcontextlost", lost);
    element.addEventListener("webglcontextrestored", start);
    void start();

    return () => {
      cancelled = true;
      element.removeEventListener("webglcontextlost", lost);
      element.removeEventListener("webglcontextrestored", start);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const label =
    state === "thinking"
      ? "обрабатывает запрос"
      : state === "responding"
        ? "отвечает"
        : state === "listening"
          ? "слушает"
          : "готово к работе";

  const neonFilter =
    state === "thinking"
      ? "hue-rotate(168deg) saturate(1.9) brightness(1.2) contrast(1.08) drop-shadow(0 0 16px rgba(45,190,255,.72)) drop-shadow(0 0 34px rgba(47,76,255,.45))"
      : state === "responding"
        ? "hue-rotate(172deg) saturate(2.05) brightness(1.26) contrast(1.08) drop-shadow(0 0 18px rgba(80,225,255,.82)) drop-shadow(0 0 38px rgba(62,90,255,.52))"
        : state === "listening"
          ? "hue-rotate(166deg) saturate(1.75) brightness(1.12) contrast(1.06) drop-shadow(0 0 14px rgba(43,192,255,.58))"
          : "hue-rotate(168deg) saturate(1.65) brightness(1.08) contrast(1.06) drop-shadow(0 0 13px rgba(38,168,255,.5))";

  return (
    <div
      className={`khasroy-core ${state}`}
      role="img"
      aria-label={`3D-ядро Хасроя, уровень ${evolution.level}: ${label}`}
      data-core-state={state}
      data-renderer={ready ? "webgl" : "fallback"}
    >
      <canvas
        ref={canvas}
        className="core-canvas"
        aria-hidden="true"
        style={{
          opacity: ready ? 1 : 0,
          filter: neonFilter,
          transition: "filter 420ms ease, opacity 260ms ease",
        }}
      />

      {!ready && (
        <svg
          className="core-fallback"
          viewBox="0 0 400 300"
          aria-hidden="true"
          style={{ filter: "drop-shadow(0 0 18px rgba(45,195,255,.75))" }}
        >
          <defs>
            <radialGradient id="core-glow">
              <stop stopColor="#eafcff" />
              <stop offset=".18" stopColor="#6fe7ff" stopOpacity=".9" />
              <stop offset=".46" stopColor="#287dff" stopOpacity=".5" />
              <stop offset="1" stopColor="#132bff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="200" cy="150" r="100" fill="url(#core-glow)" />
          <g fill="none" stroke="#5fdcff">
            <ellipse cx="200" cy="150" rx="95" ry="65" />
            <ellipse
              cx="200"
              cy="150"
              rx="48"
              ry="98"
              transform="rotate(40 200 150)"
            />
            <circle cx="200" cy="150" r="105" strokeDasharray="2 9" />
            <path d="m185 127 30 46m0-46-30 46" stroke="#a9f4ff" strokeWidth="2" />
          </g>
        </svg>
      )}
    </div>
  );
}
