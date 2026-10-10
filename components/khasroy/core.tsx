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
    <canvas
      ref={canvas}
      className={`core-canvas ${state}${failed ? " core-canvas-fallback" : ""}`}
      role="img"
      aria-label={LABELS[state]}
      onPointerDown={() => engine.current?.burst()}
    />
  );
}
