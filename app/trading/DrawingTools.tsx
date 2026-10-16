"use client";

// Drawing toolbar and SVG overlay for the Khasroy chart. Drawings are anchored to (time, price), so they
// stay put while the chart is scrolled or zoomed, and are saved in localStorage per pair.

import { useEffect, useRef, useState } from "react";
import styles from "./trading.module.css";

export type DrawChartApi = {
  width: number;
  height: number;
  /** x of a candle-grid logical index, y of a price; null while off-screen. */
  toX: (logical: number) => number | null;
  toY: (price: number) => number | null;
  fromX: (x: number) => number | null;
  fromY: (y: number) => number | null;
  /** Reference price used to detect vertical scale changes. */
  ref: number;
};

type Kind = "ray" | "text" | "rect" | "trend" | "arrow" | "brush" | "path" | "short" | "hline" | "dot" | "long" | "channel";
type Pt = { t: number; p: number };
type Shape = { id: string; kind: Kind; pts: Pt[]; text?: string };

const NEED: Record<Kind, number> = { ray: 1, text: 1, hline: 1, dot: 1, rect: 2, trend: 2, arrow: 2, short: 2, long: 2, channel: 3, brush: 0, path: 0 };
const GOLD = "#ffc44d";
const GREEN = "#26d07c";
const RED = "#ff5468";
const BLUE = "#5aa9ff";

const TOOLS: { kind: Kind; title: string; icon: React.ReactNode }[] = [
  { kind: "ray", title: "Горизонтальный луч", icon: <><path d="M5 7h22M5 17h22M5 27h16" /><circle cx="28" cy="7" r="2.6" /><circle cx="4" cy="27" r="2.6" /></> },
  { kind: "text", title: "Текст", icon: <path d="M7 6h20M17 6v22M13 28h8" /> },
  { kind: "rect", title: "Прямоугольник", icon: <><rect x="7" y="7" width="20" height="20" /><circle cx="7" cy="7" r="2.6" /><circle cx="27" cy="7" r="2.6" /><circle cx="7" cy="27" r="2.6" /><circle cx="27" cy="27" r="2.6" /></> },
  { kind: "trend", title: "Трендовая линия", icon: <><path d="M9 25L25 9" /><circle cx="7" cy="27" r="2.6" /><circle cx="27" cy="7" r="2.6" /></> },
  { kind: "arrow", title: "Стрелка", icon: <><path d="M9 25L23 11" /><path d="M16 9l10-1-1 10z" fill="currentColor" /><circle cx="7" cy="27" r="2.6" /></> },
  { kind: "brush", title: "Маркер (выделение от руки)", icon: <path d="M9 27l3-8 10-10 6 5-10 10zM12 19l6 5M6 29h12" /> },
  { kind: "path", title: "Ломаная линия", icon: <><path d="M6 22l7-7 6 5 8-9" /><path d="M23 9h4v4" /><circle cx="6" cy="22" r="2.6" /><circle cx="13" cy="15" r="2.6" /></> },
  { kind: "short", title: "Шорт (S): вход и стоп, цель 1:2", icon: <><path d="M5 7h22M5 17h22M5 27h22" /><rect x="12" y="12" width="9" height="10" rx="2" fill="#1c1f26" stroke="none" /><text x="16.5" y="21" fontSize="9" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">S</text></> },
  { kind: "hline", title: "Горизонтальная линия", icon: <><path d="M10 17h20" /><circle cx="6" cy="17" r="2.6" /></> },
  { kind: "dot", title: "Точка", icon: <circle cx="17" cy="17" r="4" fill="currentColor" stroke="none" /> },
  { kind: "long", title: "Лонг (L): вход и стоп, цель 1:2", icon: <><path d="M5 7h22M5 17h22M5 27h22" /><rect x="12" y="12" width="9" height="10" rx="2" fill="#1c1f26" stroke="none" /><text x="16.5" y="21" fontSize="9" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">L</text></> },
  { kind: "channel", title: "Параллельный канал", icon: <><path d="M7 25L26 8M12 30L30 14" /><circle cx="7" cy="25" r="2.6" /><circle cx="26" cy="8" r="2.6" /></> },
];

const KEY = (symbol: string) => `khasroy-drawings:${symbol}`;
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (p: number) => (Math.abs(p) >= 100 ? p.toFixed(2) : Math.abs(p) >= 1 ? p.toFixed(4) : p.toPrecision(4));

type Screen = { x: number; y: number };

export default function DrawingTools({ symbol, frameMs, first, api }: { symbol: string; frameMs: number; first: () => number | undefined; api: () => DrawChartApi | null }) {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Kind | null>(null);
  const [pending, setPending] = useState<Shape | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ pt: Pt; x: number; y: number; value: string } | null>(null);
  const [, setTick] = useState(0);
  const loaded = useRef<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ x: number; y: number; started: boolean } | null>(null);

  // ---- persistence ----
  useEffect(() => {
    loaded.current = null;
    try {
      const raw = localStorage.getItem(KEY(symbol));
      setShapes(raw ? (JSON.parse(raw) as Shape[]) : []);
    } catch {
      setShapes([]);
    }
    setPending(null);
    setSelected(null);
    loaded.current = symbol;
  }, [symbol]);
  useEffect(() => {
    if (loaded.current !== symbol) return;
    try {
      if (shapes.length) localStorage.setItem(KEY(symbol), JSON.stringify(shapes));
      else localStorage.removeItem(KEY(symbol));
    } catch {
      /* storage unavailable: drawings simply live for this visit */
    }
  }, [shapes, symbol]);

  // ---- follow the chart: re-render whenever its scale or position changes ----
  useEffect(() => {
    let raf = 0;
    let last = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = api();
      if (!a) return;
      const key = [a.width, a.height, a.toX(0), a.toX(1000), a.toY(a.ref), a.toY(a.ref * 1.5)].map((v) => (v === null ? "n" : Math.round(v * 10))).join("|");
      if (key !== last) {
        last = key;
        setTick((n) => n + 1);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [api]);

  const finish = (s: Shape) => {
    setShapes((old) => [...old, s]);
    setSelected(s.id);
    setPending(null);
    setTool(null);
    setCursor(null);
    gesture.current = null;
  };
  const cancel = () => {
    setPending(null);
    setDraft(null);
    gesture.current = null;
  };

  // ---- keyboard: Esc cancels, Enter ends a polyline, Delete removes the selected drawing ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        if (pending?.kind === "path" && pending.pts.length >= 2) finish(pending);
        else cancel();
        setTool(null);
        setSelected(null);
      } else if (e.key === "Enter" && pending?.kind === "path" && pending.pts.length >= 2) {
        finish(pending);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        setShapes((old) => old.filter((s) => s.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- coordinates ----
  const a = api();
  const d0 = first();
  const toScreen = (pt: Pt): Screen | null => {
    if (!a || d0 === undefined) return null;
    const x = a.toX((pt.t - d0) / frameMs);
    const y = a.toY(pt.p);
    return x === null || y === null ? null : { x, y };
  };
  const toPt = (e: { clientX: number; clientY: number }): Pt | null => {
    const box = svg.current?.getBoundingClientRect();
    if (!a || !box || d0 === undefined) return null;
    const x = Math.min(a.width, Math.max(0, e.clientX - box.left));
    const y = Math.min(a.height, Math.max(0, e.clientY - box.top));
    const l = a.fromX(x);
    const p = a.fromY(y);
    return l === null || p === null ? null : { t: d0 + l * frameMs, p };
  };

  // ---- drawing gestures (only while a tool is armed) ----
  const down = (e: React.PointerEvent) => {
    if (!tool) return;
    const pt = toPt(e);
    if (!pt) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setSelected(null);
    if (tool === "text") {
      const box = svg.current!.getBoundingClientRect();
      setDraft({ pt, x: e.clientX - box.left, y: e.clientY - box.top, value: "" });
      return;
    }
    if (NEED[tool] === 1) {
      finish({ id: uid(), kind: tool, pts: [pt] });
      return;
    }
    if (tool === "brush") {
      setPending({ id: uid(), kind: tool, pts: [pt] });
      gesture.current = { x: e.clientX, y: e.clientY, started: true };
      return;
    }
    if (!pending) {
      setPending({ id: uid(), kind: tool, pts: [pt] });
      gesture.current = { x: e.clientX, y: e.clientY, started: true };
      return;
    }
    const pts = [...pending.pts, pt];
    if (tool === "path") {
      setPending({ ...pending, pts });
      return;
    }
    if (pts.length >= NEED[tool]) finish({ ...pending, pts });
    else setPending({ ...pending, pts });
    gesture.current = { x: e.clientX, y: e.clientY, started: true };
  };
  const move = (e: React.PointerEvent) => {
    if (!tool) return;
    const pt = toPt(e);
    if (!pt) return;
    if (tool === "brush" && pending && gesture.current) setPending({ ...pending, pts: [...pending.pts, pt] });
    else setCursor(pt);
  };
  const up = (e: React.PointerEvent) => {
    if (!tool || !pending) return;
    const g = gesture.current;
    gesture.current = null;
    if (tool === "brush") {
      if (pending.pts.length > 1) finish(pending);
      else cancel();
      return;
    }
    // Dragging from the first point to another point also completes a two-point drawing.
    if (g && pending.pts.length === 1 && NEED[tool] >= 2 && tool !== "path" && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8) {
      const pt = toPt(e);
      if (!pt) return;
      if (NEED[tool] === 2) finish({ ...pending, pts: [pending.pts[0], pt] });
      else setPending({ ...pending, pts: [pending.pts[0], pt] });
    }
  };
  const dbl = () => {
    if (pending?.kind === "path") {
      const pts = pending.pts.slice(0, -1); // the double click added the last point twice
      if (pts.length >= 2) finish({ ...pending, pts });
      else cancel();
    }
  };
  const commitText = () => {
    if (draft && draft.value.trim()) finish({ id: uid(), kind: "text", pts: [draft.pt], text: draft.value.trim().slice(0, 80) });
    else setTool(null);
    setDraft(null);
  };

  // ---- rendering ----
  const W = a?.width ?? 0;
  const H = a?.height ?? 0;
  const render = (s: Shape, preview = false) => {
    const sp = s.pts.map(toScreen);
    const live = preview ? [...s.pts, ...(cursor && NEED[s.kind] !== 0 ? [cursor] : [])] : s.pts;
    const lp = preview ? live.map(toScreen) : sp;
    const pts = lp.filter((p): p is Screen => p !== null);
    if (!pts.length) return null;
    const on = s.id === selected;
    const hit = {
      onPointerDown: (e: React.PointerEvent) => {
        if (tool) return;
        e.stopPropagation();
        setSelected(s.id);
      },
      style: { pointerEvents: preview || tool ? ("none" as const) : ("stroke" as const), cursor: "pointer" },
    };
    const stroke = on ? "#fff" : GOLD;
    const [p1, p2] = pts;
    const line = (x1: number, y1: number, x2: number, y2: number, color = stroke, extra: Record<string, unknown> = {}) => (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="12" {...hit} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={on ? 2.2 : 1.6} pointerEvents="none" {...extra} />
      </>
    );
    let body: React.ReactNode = null;
    switch (s.kind) {
      case "hline": {
        body = <>{line(0, p1.y, W, p1.y)}<text x={W - 6} y={p1.y - 4} textAnchor="end" fontSize="10" fill={GOLD}>{fmt(s.pts[0].p)}</text></>;
        break;
      }
      case "ray":
        body = line(p1.x, p1.y, W, p1.y);
        break;
      case "dot":
        body = <circle cx={p1.x} cy={p1.y} r={on ? 6 : 5} fill={GOLD} stroke="#0d1017" strokeWidth="1.5" {...hit} style={{ ...hit.style, pointerEvents: preview ? "none" : "all" }} />;
        break;
      case "text":
        body = <text x={p1.x} y={p1.y} fontSize="13" fontWeight="700" fill={on ? "#fff" : GOLD} stroke="#0d1017" strokeWidth="3" paintOrder="stroke" {...hit} style={{ ...hit.style, pointerEvents: "all" }}>{s.text}</text>;
        break;
      case "rect":
        if (p2) body = <rect x={Math.min(p1.x, p2.x)} y={Math.min(p1.y, p2.y)} width={Math.abs(p2.x - p1.x)} height={Math.abs(p2.y - p1.y)} fill="rgba(255,196,77,0.14)" stroke={stroke} strokeWidth={on ? 2 : 1.4} {...hit} style={{ ...hit.style, pointerEvents: preview ? "none" : "all" }} />;
        break;
      case "trend":
        if (p2) body = line(p1.x, p1.y, p2.x, p2.y);
        break;
      case "arrow":
        if (p2) {
          const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const hd = (r: number) => `${p2.x - 12 * Math.cos(ang - r)},${p2.y - 12 * Math.sin(ang - r)}`;
          body = <>{line(p1.x, p1.y, p2.x, p2.y)}<polygon points={`${p2.x},${p2.y} ${hd(0.4)} ${hd(-0.4)}`} fill={stroke} pointerEvents="none" /></>;
        }
        break;
      case "brush":
        body = <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={on ? "#fff" : "rgba(255,196,77,0.45)"} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" {...hit} />;
        break;
      case "path":
        body = <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={stroke} strokeWidth={on ? 2.2 : 1.6} strokeLinejoin="round" {...hit} />;
        break;
      case "long":
      case "short": {
        if (!p2) break;
        const entry = s.pts[0].p;
        const stop = (preview ? live[1] : s.pts[1]).p;
        const target = entry - 2 * (stop - entry);
        const yT = a?.toY(target) ?? null;
        if (yT === null) break;
        const x1 = Math.min(p1.x, p2.x);
        const x2 = Math.max(Math.max(p1.x, p2.x), x1 + 24);
        const isLong = s.kind === "long";
        const ok = isLong ? stop < entry : stop > entry;
        const pct = (Math.abs(stop - entry) / entry) * 100;
        body = (
          <g {...hit} style={{ ...hit.style, pointerEvents: preview ? "none" : "all" }}>
            <rect x={x1} y={Math.min(p1.y, yT)} width={x2 - x1} height={Math.abs(yT - p1.y)} fill="rgba(38,208,124,0.2)" stroke={on ? GREEN : "none"} />
            <rect x={x1} y={Math.min(p1.y, p2.y)} width={x2 - x1} height={Math.abs(p2.y - p1.y)} fill="rgba(255,84,104,0.2)" stroke={on ? RED : "none"} />
            <line x1={x1} x2={x2} y1={p1.y} y2={p1.y} stroke="#d9d4f5" strokeWidth="1.4" />
            <text x={x1 + 5} y={yT + (yT < p1.y ? 12 : -4)} fontSize="10" fontWeight="700" fill={GREEN}>цель {fmt(target)}</text>
            <text x={x1 + 5} y={p2.y + (p2.y > p1.y ? -4 : 12)} fontSize="10" fontWeight="700" fill={RED}>стоп {fmt(stop)} · {pct.toFixed(2)}%</text>
            <text x={x1 + 5} y={p1.y - 4} fontSize="10" fontWeight="700" fill="#d9d4f5">{isLong ? "L" : "S"} {fmt(entry)} · 1:2{ok ? "" : " (стоп не с той стороны)"}</text>
          </g>
        );
        break;
      }
      case "channel": {
        if (!p2) break;
        const A = s.pts[0];
        const B = s.pts[1];
        const C = preview ? live[2] : s.pts[2];
        if (!C || B.t === A.t) {
          body = line(p1.x, p1.y, p2.x, p2.y);
          break;
        }
        const off = C.p - (A.p + ((B.p - A.p) * (C.t - A.t)) / (B.t - A.t));
        const q1 = toScreen({ t: A.t, p: A.p + off });
        const q2 = toScreen({ t: B.t, p: B.p + off });
        if (!q1 || !q2) break;
        body = (
          <>
            <polygon points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${q2.x},${q2.y} ${q1.x},${q1.y}`} fill="rgba(90,169,255,0.12)" pointerEvents="none" />
            {line(p1.x, p1.y, p2.x, p2.y, on ? "#fff" : BLUE)}
            {line(q1.x, q1.y, q2.x, q2.y, on ? "#fff" : BLUE)}
            {line((p1.x + q1.x) / 2, (p1.y + q1.y) / 2, (p2.x + q2.x) / 2, (p2.y + q2.y) / 2, on ? "#fff" : BLUE, { strokeDasharray: "4 4", strokeOpacity: 0.7 })}
          </>
        );
        break;
      }
    }
    return (
      <g key={s.id}>
        {body}
        {on && !preview ? sp.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke="#0d1017" pointerEvents="none" /> : null)) : null}
      </g>
    );
  };

  return (
    <>
      <div className={styles.drawBar} role="toolbar" aria-label="Инструменты рисования">
        <span className={styles.drawGrip} aria-hidden>⠿</span>
        {TOOLS.map((t) => (
          <button key={t.kind} type="button" data-on={tool === t.kind || undefined} title={t.title} aria-label={t.title} aria-pressed={tool === t.kind} onClick={() => { cancel(); setTool(tool === t.kind ? null : t.kind); }}>
            <svg viewBox="0 0 34 34" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
          </button>
        ))}
        <span className={styles.drawSep} aria-hidden />
        <button type="button" title="Удалить выбранное (Delete)" aria-label="Удалить выбранное" disabled={!selected} onClick={() => { setShapes((o) => o.filter((s) => s.id !== selected)); setSelected(null); }}>🗑</button>
        <button type="button" title="Стереть все рисунки на этой паре" aria-label="Стереть всё" disabled={!shapes.length} onClick={() => { if (window.confirm("Стереть все рисунки на этой паре?")) { setShapes([]); setSelected(null); } }}>✕</button>
      </div>
      <div className={styles.drawLayer} style={{ width: W || "100%", height: H || "100%" }}>
        <svg ref={svg} width="100%" height="100%">
          {shapes.map((s) => render(s))}
          {pending ? render(pending, true) : null}
          {tool ? (
            <rect
              x="0" y="0" width="100%" height="100%" fill="transparent"
              style={{ pointerEvents: "all", cursor: "crosshair", touchAction: "none" }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={dbl}
            />
          ) : (
            <rect x="0" y="0" width="100%" height="100%" fill="transparent" style={{ pointerEvents: "none" }} />
          )}
        </svg>
        {draft ? (
          <input
            className={styles.drawText}
            style={{ left: Math.min(draft.x, Math.max(0, W - 170)), top: draft.y - 14 }}
            autoFocus
            placeholder="Текст…"
            value={draft.value}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") commitText(); else if (e.key === "Escape") { setDraft(null); setTool(null); } }}
            onBlur={commitText}
          />
        ) : null}
        {tool ? <div className={styles.drawHint}>{tool === "path" ? "Клики — точки, двойной клик или Enter — закончить" : tool === "brush" ? "Зажмите и ведите по графику" : NEED[tool] > 1 ? "Нажмите в начале и в конце (или протяните). Esc — отмена" : "Нажмите на график. Esc — отмена"}</div> : null}
      </div>
    </>
  );
}
