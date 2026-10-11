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
 * A small plane circling the storm cloud. It flies a tilted ellipse: larger and bright on the
 * near side, smaller and faded on the far side, so it seems to pass behind the cloud.
 */
function Plane() {
  const orbit = "M 200 205 C 330 205 392 168 380 140 C 368 112 300 96 200 96 C 100 96 32 112 20 140 C 8 168 70 205 200 205 Z";
  return (
    <svg className="core-plane" viewBox="0 0 400 300" aria-hidden="true" focusable="false">
      <g>
        <animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path={orbit} />
        <animate
          attributeName="opacity"
          dur="16s"
          repeatCount="indefinite"
          values="1;0.9;0.25;0.25;0.9;1"
          keyTimes="0;0.2;0.32;0.68;0.8;1"
        />
        <animateTransform
          attributeName="transform"
          type="scale"
          dur="16s"
          repeatCount="indefinite"
          values="1;0.8;0.55;0.55;0.8;1"
          keyTimes="0;0.2;0.32;0.68;0.8;1"
        />
        {/* Nose points along +x, the direction animateMotion's rotate="auto" follows. */}
        <path
          d="M 9 0 L 3 -1.2 L -1 -7 L -3 -7 L -1 -1.3 L -6 -1.2 L -8 -3.5 L -9.5 -3.5 L -8.2 0 L -9.5 3.5 L -8 3.5 L -6 1.2 L -1 1.3 L -3 7 L -1 7 L 3 1.2 Z"
          fill="#dcecff"
          stroke="#7fb4ff"
          strokeWidth="0.4"
        />
        <circle cx="-9" cy="0" r="1.1" fill="#9fd0ff" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0.2;0.7" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}
