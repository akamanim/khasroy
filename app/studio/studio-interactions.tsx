"use client";

import { useEffect, useRef, useState } from "react";
import { Grid3X3, Redo2, RotateCcw, Undo2 } from "lucide-react";
import styles from "./studio-interactions.module.css";

const STORAGE_KEY = "khasroy-studio-v1";
const HISTORY_KEY = "khasroy-studio-history-v1";
const HISTORY_INDEX_KEY = "khasroy-studio-history-index-v1";
const MAX_HISTORY = 40;

type StudioProject = {
  projectName?: string;
  pageBackground?: string;
  pageHeight?: number;
  elements?: Array<{
    id?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

function readHistory(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readIndex(history: string[]) {
  const raw = Number(window.localStorage.getItem(HISTORY_INDEX_KEY));
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 0), Math.max(history.length - 1, 0)) : Math.max(history.length - 1, 0);
}

function writeHistory(history: string[], index: number) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  window.localStorage.setItem(HISTORY_INDEX_KEY, String(index));
}

function readProject(): StudioProject | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StudioProject) : null;
  } catch {
    return null;
  }
}

function roundToGrid(value: number, grid: number) {
  return Math.max(0, Math.round(value / grid) * grid);
}

export function StudioInteractions() {
  const [gridEnabled, setGridEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(10);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const applyingRef = useRef(false);
  const lastRecordedRef = useRef<string>("");

  function refreshHistoryState() {
    const history = readHistory();
    const index = readIndex(history);
    setHistoryState({ canUndo: history.length > 1 && index > 0, canRedo: history.length > 1 && index < history.length - 1 });
  }

  function recordSnapshot(raw: string) {
    if (!raw || applyingRef.current || raw === lastRecordedRef.current) return;
    let history = readHistory();
    let index = readIndex(history);
    if (history[index] === raw) {
      lastRecordedRef.current = raw;
      refreshHistoryState();
      return;
    }
    history = history.slice(0, index + 1);
    history.push(raw);
    if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
    index = history.length - 1;
    writeHistory(history, index);
    lastRecordedRef.current = raw;
    refreshHistoryState();
  }

  useEffect(() => {
    const initial = window.localStorage.getItem(STORAGE_KEY);
    if (initial) recordSnapshot(initial);

    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key: string, value: string) {
      original.call(this, key, value);
      if (this === window.localStorage && key === STORAGE_KEY) {
        window.setTimeout(() => recordSnapshot(value), 0);
      }
    };

    return () => {
      Storage.prototype.setItem = original;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function applyHistory(index: number) {
    const history = readHistory();
    if (!history[index]) return;
    applyingRef.current = true;
    window.localStorage.setItem(STORAGE_KEY, history[index]);
    writeHistory(history, index);
    lastRecordedRef.current = history[index];
    window.location.reload();
  }

  function undo() {
    const history = readHistory();
    const index = readIndex(history);
    if (index > 0) applyHistory(index - 1);
  }

  function redo() {
    const history = readHistory();
    const index = readIndex(history);
    if (index < history.length - 1) applyHistory(index + 1);
  }

  function snapAll() {
    const project = readProject();
    if (!project?.elements?.length) return;
    const next: StudioProject = {
      ...project,
      elements: project.elements.map((element) => ({
        ...element,
        x: roundToGrid(Number(element.x) || 0, gridSize),
        y: roundToGrid(Number(element.y) || 0, gridSize),
        width: Math.max(gridSize * 2, roundToGrid(Number(element.width) || gridSize * 2, gridSize)),
        height: Math.max(gridSize * 2, roundToGrid(Number(element.height) || gridSize * 2, gridSize)),
      })),
    };
    const raw = JSON.stringify(next);
    recordSnapshot(raw);
    applyingRef.current = true;
    window.localStorage.setItem(STORAGE_KEY, raw);
    window.location.reload();
  }

  function resetHistory() {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (!current) return;
    writeHistory([current], 0);
    lastRecordedRef.current = current;
    refreshHistoryState();
  }

  return (
    <div className={styles.proBar} aria-label="Studio Pro tools">
      <div className={styles.badge}>PRO</div>
      <button onClick={undo} disabled={!historyState.canUndo} title="Отменить · Ctrl/Cmd+Z"><Undo2 size={15} /></button>
      <button onClick={redo} disabled={!historyState.canRedo} title="Повторить · Ctrl/Cmd+Shift+Z"><Redo2 size={15} /></button>
      <span className={styles.divider} />
      <button className={gridEnabled ? styles.active : ""} onClick={() => setGridEnabled((value) => !value)} title="Сетка"><Grid3X3 size={15} /></button>
      {gridEnabled && (
        <>
          <select value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))} aria-label="Шаг сетки">
            <option value={5}>5px</option>
            <option value={10}>10px</option>
            <option value={20}>20px</option>
            <option value={25}>25px</option>
          </select>
          <button className={styles.snap} onClick={snapAll}>Привязать всё</button>
        </>
      )}
      <button onClick={resetHistory} title="Очистить историю"><RotateCcw size={14} /></button>
    </div>
  );
}
