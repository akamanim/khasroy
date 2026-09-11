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
    typeof import("./core-scene-v5").createCoreScene
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
        const { createCoreScene } = await import("./core-scene-v5");
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
      ? "brightness(1.08) contrast(1.03) drop-shadow(0 0 12px rgba(60,205,255,.44))"
      : state === "responding"
        ? "brightness(1.10) contrast(1.03) drop-shadow(0 0 14px rgba(90,225,255,.48))"
        : state === "listening"
          ? "brightness(1.04) drop-shadow(0 0 9px rgba(50,185,255,.32))"
          : "brightness(1.01) drop-shadow(0 0 8px rgba(40,160,255,.24))";

  return (
    <div
      className={`khasroy-core ${state}`}
      role="img"
      aria-label={`3D-проекция сознания Хасроя, уровень ${evolution.level}: ${label}`}
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
          style={{ filter: "drop-shadow(0 0 16px rgba(45,195,255,.68))" }}
        >
          <defs>
            <radialGradient id="field-glow">
              <stop stopColor="#eafcff" />
              <stop offset=".2" stopColor="#6fe7ff" stopOpacity=".82" />
              <stop offset=".58" stopColor="#287dff" stopOpacity=".24" />
              <stop offset="1" stopColor="#132bff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d="M88 161C99 93 149 62 217 74c53 9 104 48 96 102-7 46-55 74-113 66-61-8-123-33-112-81Z" fill="url(#field-glow)" opacity=".72" />
          <g fill="none" stroke="#5fdcff" opacity=".64">
            <path d="M102 157 147 116l42 22 31-47 43 39 36 10" />
            <path d="m111 188 53-34 32 39 50-53 45 39" />
            <path d="m137 91 27 63 54 16 22 51" />
          </g>
          <g fill="#dffcff">
            <circle cx="147" cy="116" r="3"/><circle cx="189" cy="138" r="2.5"/><circle cx="220" cy="91" r="4"/><circle cx="263" cy="130" r="3"/><circle cx="164" cy="154" r="2.5"/><circle cx="196" cy="193" r="3"/><circle cx="246" cy="140" r="2.5"/>
          </g>
        </svg>
      )}
    </div>
  );
}
