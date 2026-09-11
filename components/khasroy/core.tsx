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
        style={{ opacity: ready ? 1 : 0 }}
      />
      {!ready && (
        <svg className="core-fallback" viewBox="0 0 400 300" aria-hidden="true">
          <defs>
            <radialGradient id="core-glow">
              <stop stopColor="#ffdc91" />
              <stop offset=".22" stopColor="#e97c26" stopOpacity=".5" />
              <stop offset="1" stopColor="#e97c26" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="200" cy="150" r="100" fill="url(#core-glow)" />
          <g fill="none" stroke="#eea357">
            <ellipse cx="200" cy="150" rx="95" ry="65" />
            <ellipse
              cx="200"
              cy="150"
              rx="48"
              ry="98"
              transform="rotate(40 200 150)"
            />
            <circle cx="200" cy="150" r="105" strokeDasharray="2 9" />
            <path d="m185 127 30 46m0-46-30 46" strokeWidth="2" />
          </g>
        </svg>
      )}
    </div>
  );
}
