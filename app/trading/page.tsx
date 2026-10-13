"use client";

// Khasroy Trading — live Binance Futures chart (TradingView Lightweight Charts), Khasroy's rule-based
// analysis of the pair, the signal journal, a paper wallet that takes every signal, and the same
// rule replayed on recent history. Market data and the journal come from the khasroy-trading edge
// function (Binance answers there); live candles stream straight from Binance when the browser can.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyze, chartTrades, equityPath, historyTrades, journalTrade, paperWallet, tradeStory, type ChartTrade, type JournalSignal } from "@/lib/trading/analysis";
import type { Candle } from "@/lib/trading/smc";
import styles from "./trading.module.css";

const EDGE = "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-trading";
const LWC = "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js";
const PAIRS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "TRXUSDT", "ATOMUSDT"];
const FRAMES: [string, string][] = [["5m", "5м"], ["15m", "15м"], ["1h", "1ч"], ["4h", "4ч"], ["1d", "1д"]];
const FRAME_MS: Record<string, number> = { "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };
const GREEN = "#26d07c";
const RED = "#ff5468";
const VIOLET = "#8853fd";

type Market = { symbol: string; price: number; change: number; volume: number; funding: number; nextFunding: number };
type Raw = [number, number, number, number, number, number, number];

async function edge<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(EDGE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`данные не пришли (${res.status})`);
  return (await res.json()) as T;
}
const toCandles = (raw: Raw[]): (Candle & { closed: boolean })[] => raw.map((k) => ({ t: k[0], o: k[1], h: k[2], l: k[3], c: k[4], v: k[5], closed: k[6] === 1 }));
const short = (s: string) => s.replace("USDT", "");
const decimals = (p: number) => (p >= 1000 ? 1 : p >= 10 ? 2 : p >= 1 ? 4 : p >= 0.1 ? 5 : 6);
const fp = (p: number) => (Number.isFinite(p) ? p.toLocaleString("ru-RU", { minimumFractionDigits: decimals(p), maximumFractionDigits: decimals(p) }) : "—");
const TV_INTERVAL: Record<string, string> = { "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
/** Months covered by a balance path, rounded. */
const months = (path: { t: number }[]) => Math.max(1, Math.round((path[path.length - 1].t - path[0].t) / (30 * 864e5)));
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sign = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const TZ = -new Date().getTimezoneOffset() * 60; // show local time on the chart

// lightweight-charts is loaded once from the CDN (TradingView's open-source chart library).
type LW = {
  createChart: (el: HTMLElement, o: unknown) => Chart;
  CrosshairMode: { Normal: number };
  LineStyle: { Solid: number; Dashed: number; Dotted: number };
};
type Series = {
  setData: (d: unknown[]) => void;
  update: (d: unknown) => void;
  setMarkers?: (m: unknown[]) => void;
  createPriceLine: (o: unknown) => unknown;
  removePriceLine: (l: unknown) => void;
  applyOptions: (o: unknown) => void;
  priceToCoordinate: (p: number) => number | null;
};
type Chart = {
  addCandlestickSeries: (o: unknown) => Series;
  addHistogramSeries: (o: unknown) => Series;
  addLineSeries: (o: unknown) => Series;
  priceScale: (id: string) => { applyOptions: (o: unknown) => void; width: () => number };
  timeScale: () => {
    fitContent: () => void;
    scrollToRealTime: () => void;
    applyOptions: (o: unknown) => void;
    logicalToCoordinate: (l: number) => number | null;
    setVisibleLogicalRange: (r: { from: number; to: number }) => void;
  };
  subscribeClick: (cb: (p: { time?: number }) => void) => void;
  applyOptions: (o: unknown) => void;
  remove: () => void;
};
let lwPromise: Promise<LW> | null = null;
function loadLW(): Promise<LW> {
  const w = window as unknown as { LightweightCharts?: LW };
  if (w.LightweightCharts) return Promise.resolve(w.LightweightCharts);
  lwPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = LWC;
    s.async = true;
    s.onload = () => (w.LightweightCharts ? resolve(w.LightweightCharts) : reject(new Error("chart library")));
    s.onerror = () => reject(new Error("chart library"));
    document.head.appendChild(s);
  });
  return lwPromise;
}

export default function TradingPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [frame, setFrame] = useState("4h");
  const [show, setShow] = useState({ channel: true, ema: true, trades: true });
  const [market, setMarket] = useState<Market[]>([]);
  const [journal, setJournal] = useState<JournalSignal[]>([]);
  const [c4h, setC4h] = useState<Record<string, Candle[]>>({});
  const [live, setLive] = useState<{ price: number; at: number } | null>(null);
  const [risk, setRisk] = useState(0.5);
  const [start] = useState(200);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [stream, setStream] = useState<"ws" | "poll" | "off">("off");
  const [chartReady, setChartReady] = useState(false);
  /** "draw": TradingView chart with its drawing tools; "khasroy": our chart with Khasroy's levels. */
  const [view, setView] = useState<"draw" | "khasroy">("khasroy");
  const [picked, setPicked] = useState<string | null>(null);
  const [notes, setNotes] = useState(true);

  // ---------- market, journal, 4h history ----------
  const refreshMarket = useCallback(() => edge<{ pairs: Market[] }>({ action: "market" }).then((d) => setMarket(d.pairs)).catch((e) => setError(String(e.message || e))), []);
  const refreshJournal = useCallback(() => edge<{ signals: (JournalSignal & { entry: string | number })[] }>({ action: "journal" }).then((d) => setJournal(d.signals.map((s) => ({ ...s, entry: +s.entry, sl: +s.sl, tp: +s.tp, r: s.r === null ? null : +s.r })))).catch(() => undefined), []);
  useEffect(() => {
    refreshMarket();
    refreshJournal();
    const a = setInterval(refreshMarket, 10_000);
    const b = setInterval(refreshJournal, 60_000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [refreshMarket, refreshJournal]);
  useEffect(() => {
    // 1500 four-hour candles (~250 days) per pair: analysis and the history replay.
    let cancelled = false;
    (async () => {
      const out: Record<string, Candle[]> = {};
      await Promise.all(PAIRS.map(async (p) => {
        try {
          const d = await edge<{ candles: Raw[] }>({ action: "klines", symbol: p, interval: "4h", limit: 1500 });
          out[p] = toCandles(d.candles).filter((x) => x.closed);
        } catch { /* one pair missing is fine */ }
      }));
      if (!cancelled) setC4h(out);
    })();
    const t = setInterval(async () => {
      // A new 4h candle closes every 4 hours; refresh the pair on screen.
      try {
        const d = await edge<{ candles: Raw[] }>({ action: "klines", symbol, interval: "4h", limit: 1500 });
        setC4h((old) => ({ ...old, [symbol]: toCandles(d.candles).filter((x) => x.closed) }));
      } catch { /* next time */ }
    }, 5 * 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [symbol]);

  const m = market.find((x) => x.symbol === symbol);
  const price = live?.price ?? m?.price ?? NaN;
  const analysis = useMemo(() => (c4h[symbol] && Number.isFinite(price) ? analyze(c4h[symbol], price, m?.funding ?? null) : null), [c4h, symbol, price, m?.funding]);
  const radar = useMemo(() => PAIRS.map((p) => {
    const mk = market.find((x) => x.symbol === p);
    const a = c4h[p] && mk ? analyze(c4h[p], mk.price, mk.funding) : null;
    return { p, mk, a };
  }), [market, c4h]);

  const prices = useMemo(() => Object.fromEntries(market.map((x) => [x.symbol, x.price])), [market]);
  const wallet = useMemo(() => paperWallet(journal, start, risk, { ...prices, ...(live ? { [symbol]: live.price } : {}) }), [journal, start, risk, prices, live, symbol]);
  const history = useMemo(() => {
    if (Object.keys(c4h).length < 6) return null;
    const trades = historyTrades(c4h);
    return { ...equityPath(trades, start, risk), list: trades };
  }, [c4h, start, risk]);
  /** Trades drawn on the chart: the rule replayed on this pair's 4h candles, plus real signals from the journal. */
  const trades = useMemo<ChartTrade[]>(() => {
    const hist = c4h[symbol] ? chartTrades(c4h[symbol]) : [];
    const live = journal.filter((s) => s.symbol === symbol).map(journalTrade);
    const liveT = new Set(live.map((t) => t.entryT));
    return [...hist.filter((t) => !liveT.has(t.entryT)), ...live].sort((a, b) => a.entryT - b.entryT);
  }, [c4h, symbol, journal]);
  const selected = trades.find((t) => t.id === picked) ?? trades[trades.length - 1] ?? null;
  const story = useMemo(() => (selected && c4h[symbol] && Number.isFinite(price) ? tradeStory(c4h[symbol], selected, price) : null), [selected, c4h, symbol, price]);
  const next4h = Math.ceil(now / FRAME_MS["4h"]) * FRAME_MS["4h"];
  const left = Math.max(0, next4h - now);
  const leftText = `${Math.floor(left / 3.6e6)}:${String(Math.floor((left % 3.6e6) / 6e4)).padStart(2, "0")}:${String(Math.floor((left % 6e4) / 1000)).padStart(2, "0")}`;

  // ---------- chart ----------
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<{ c: Chart; candles: Series; volume: Series; hi: Series; lo: Series; e50: Series; e200: Series; lines: unknown[]; lw: LW } | null>(null);
  const data = useRef<(Candle & { closed: boolean })[]>([]);

  useEffect(() => {
    let disposed = false;
    loadLW().then((lw) => {
      if (disposed || !box.current) return;
      const c = lw.createChart(box.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#8b93a7", fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        crosshair: { mode: lw.CrosshairMode.Normal },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
        timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false, rightOffset: 6 },
      });
      const candles = c.addCandlestickSeries({ upColor: GREEN, downColor: RED, borderUpColor: GREEN, borderDownColor: RED, wickUpColor: GREEN, wickDownColor: RED });
      const volume = c.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      const line = (color: string, style: number, width = 1) => c.addLineSeries({ color, lineWidth: width, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      chart.current = {
        c, candles, volume, lw, lines: [],
        hi: line("rgba(38,208,124,0.75)", lw.LineStyle.Dashed),
        lo: line("rgba(255,84,104,0.75)", lw.LineStyle.Dashed),
        e50: line("rgba(255,196,77,0.8)", lw.LineStyle.Solid),
        e200: line("rgba(136,83,253,0.9)", lw.LineStyle.Solid, 2),
      };
      setChartReady(true);
    }).catch(() => setError("Не загрузилась библиотека графика. Обновите страницу."));
    return () => {
      disposed = true;
      chart.current?.c.remove();
      chart.current = null;
    };
  }, []);

  // ---------- TradingView chart (drawing tools) ----------
  const tvBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tvBox.current;
    if (!el || view !== "draw") return;
    el.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    el.appendChild(inner);
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol: `BINANCE:${symbol}.P`,
      interval: TV_INTERVAL[frame] ?? "240",
      timezone: "Asia/Bishkek",
      theme: "dark",
      style: "1",
      locale: "ru",
      backgroundColor: "#0d1017",
      gridColor: "rgba(255,255,255,0.04)",
      hide_side_toolbar: false,
      allow_symbol_change: false,
      withdateranges: true,
      save_image: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(s);
    return () => { el.innerHTML = ""; };
  }, [symbol, frame, view]);

  const toBar = (k: Candle) => ({ time: k.t / 1000 + TZ, open: k.o, high: k.h, low: k.l, close: k.c });
  const toVol = (k: Candle) => ({ time: k.t / 1000 + TZ, value: k.v, color: k.c >= k.o ? "rgba(38,208,124,0.35)" : "rgba(255,84,104,0.35)" });

  /** Overlays: channel and EMAs computed on the candles shown, signal lines and markers. */
  const drawOverlays = useCallback(() => {
    const ch = chart.current;
    const d = data.current;
    if (!ch || d.length < 10) return;
    const n = 100;
    const hi: { time: number; value: number }[] = [];
    const lo: { time: number; value: number }[] = [];
    if (show.channel) {
      for (let i = n; i < d.length; i++) {
        let h = -Infinity;
        let l = Infinity;
        for (let k = i - n; k < i; k++) { h = Math.max(h, d[k].h); l = Math.min(l, d[k].l); }
        hi.push({ time: d[i].t / 1000 + TZ, value: h });
        lo.push({ time: d[i].t / 1000 + TZ, value: l });
      }
    }
    ch.hi.setData(hi);
    ch.lo.setData(lo);
    const emaLine = (len: number) => {
      if (!show.ema) return [];
      const k = 2 / (len + 1);
      let prev = d[0].c;
      return d.map((x, i) => ({ time: x.t / 1000 + TZ, value: (prev = i === 0 ? x.c : x.c * k + prev * (1 - k)) })).slice(Math.min(len, d.length - 1));
    };
    ch.e50.setData(emaLine(50));
    ch.e200.setData(emaLine(200));
    for (const l of ch.lines) ch.candles.removePriceLine(l);
    ch.lines = [];
    const add = (price: number, color: string, title: string, style = ch.lw.LineStyle.Dashed) => ch.lines.push(ch.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    // On every timeframe, the 4h levels that make the next signal.
    if (analysis && frame !== "4h") {
      add(analysis.breakoutHigh, "rgba(38,208,124,0.7)", "пробой 4ч ↑", ch.lw.LineStyle.Dotted);
      add(analysis.breakoutLow, "rgba(255,84,104,0.7)", "пробой 4ч ↓", ch.lw.LineStyle.Dotted);
    }
  }, [analysis, frame, show]);

  // Load candles for the pair and timeframe, then follow them live.
  useEffect(() => {
    const ch = chart.current;
    if (!ch || !chartReady) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const p = m?.price ?? 1000;
    ch.candles.applyOptions({ priceFormat: { type: "price", precision: decimals(p), minMove: 1 / 10 ** decimals(p) } });
    const apply = (k: Candle & { closed: boolean }) => {
      const d = data.current;
      const last = d[d.length - 1];
      if (last && k.t < last.t) return;
      if (last && k.t === last.t) d[d.length - 1] = k;
      else {
        d.push(k);
        drawOverlays();
      }
      ch.candles.update(toBar(k));
      ch.volume.update(toVol(k));
      setLive({ price: k.c, at: Date.now() });
    };
    edge<{ candles: Raw[] }>({ action: "klines", symbol, interval: frame, limit: 1000 })
      .then((d) => {
        if (cancelled) return;
        data.current = toCandles(d.candles);
        ch.candles.setData(data.current.map(toBar));
        ch.volume.setData(data.current.map(toVol));
        drawOverlays();
        ch.c.timeScale().fitContent();
        const last = data.current[data.current.length - 1];
        if (last) setLive({ price: last.c, at: Date.now() });
        // Live candles straight from Binance; if the socket is blocked, poll every 5 seconds.
        const startPoll = () => {
          if (poll) return;
          setStream("poll");
          poll = setInterval(() => {
            edge<{ candles: Raw[] }>({ action: "klines", symbol, interval: frame, limit: 2 }).then((x) => toCandles(x.candles).forEach(apply)).catch(() => undefined);
          }, 5000);
        };
        try {
          ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${frame}`);
          const timer = setTimeout(() => { if (ws && ws.readyState !== 1) { ws.close(); startPoll(); } }, 6000);
          ws.onopen = () => { clearTimeout(timer); setStream("ws"); };
          ws.onmessage = (e) => {
            const k = JSON.parse(e.data as string).k;
            if (k) apply({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, closed: Boolean(k.x) });
          };
          ws.onerror = () => startPoll();
          ws.onclose = () => { if (!cancelled) startPoll(); };
        } catch {
          startPoll();
        }
      })
      .catch((e) => setError(String(e.message || e)));
    return () => {
      cancelled = true;
      if (ws) { ws.onclose = null; ws.close(); }
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, frame, chartReady]);
  useEffect(() => { drawOverlays(); }, [drawOverlays]);

  // Click on the chart: pick the trade under the cursor.
  const tradesRef = useRef(trades);
  tradesRef.current = trades;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    const ch = chart.current;
    if (!ch || !chartReady) return;
    ch.c.subscribeClick((p) => {
      if (typeof p.time !== "number") return;
      const t = (p.time - TZ) * 1000;
      const hit = [...tradesRef.current].reverse().find((x) => x.entryT - FRAME_MS[frameRef.current] <= t && t <= (x.exitT ?? Infinity) + FRAME_MS["4h"]);
      if (hit) setPicked(hit.id);
    });
  }, [chartReady]);

  /** Screen positions of the trade boxes and Khasroy's notes, recomputed while the chart moves. */
  type Layout = {
    w: number;
    h: number;
    boxes: { id: string; x1: number; x2: number; ye: number; yt: number; ys: number; side: string; status: string; live: boolean; on: boolean }[];
    tags: { id: string; x: number; y: number; ax: number; ay: number; kind: "hint" | "trade"; text: string; bx: number; by: number; w: number }[];
  };
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    if (view !== "khasroy") return;
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ch = chart.current;
      const d = data.current;
      const el = box.current;
      if (!ch || !el || d.length < 2) return;
      const fm = FRAME_MS[frame];
      const ts = ch.c.timeScale();
      const w = el.clientWidth - ch.c.priceScale("right").width();
      const h = el.clientHeight - 28;
      const lastT = d[d.length - 1].t;
      const xOf = (t: number) => ts.logicalToCoordinate((Math.floor(t / fm) * fm - d[0].t) / fm);
      const yOf = (p: number) => ch.candles.priceToCoordinate(p);
      const out: Layout = { w, h, boxes: [], tags: [] };
      const clampX = (x: number, bw: number) => Math.max(6, Math.min(w - bw - 6, x));
      const clampY = (y: number, bh: number) => Math.max(6, Math.min(h - bh - 6, y));
      if (show.trades) {
        for (const t of trades) {
          const x1 = xOf(t.entryT);
          const x2raw = t.exitT === null ? xOf(Math.max(lastT, t.entryT) + 6 * Math.max(fm, FRAME_MS["1h"])) : xOf(t.exitT + FRAME_MS["4h"] - 1);
          const ye = yOf(t.entry);
          const yt = yOf(t.tp);
          const ys = yOf(t.sl);
          if (x1 === null || x2raw === null || ye === null || yt === null || ys === null) continue;
          const x2 = Math.max(x2raw, x1 + 6);
          if (x2 < 0 || x1 > w) continue;
          const on = t.id === selected?.id;
          out.boxes.push({ id: t.id, x1: Math.max(0, x1), x2: Math.min(w, x2), ye, yt, ys, side: t.side, status: t.status, live: t.live, on });
          if (on && story) {
            const bw = 300;
            const bh = 112;
            const by = t.side === "long" ? Math.max(ys, ye) + 18 : Math.min(ys, ye) - 18 - bh;
            out.tags.push({ id: t.id, kind: "trade", x: x1, y: ye, ax: x1, ay: ye, bx: clampX(x1 - 40, bw), by: clampY(by, bh), w: bw, text: "" });
          }
        }
      }
      if (notes && analysis) {
        for (const c of analysis.callouts) {
          const x = c.id === "now" ? xOf(lastT) : xOf(c.t);
          const y = yOf(c.price);
          if (x === null || y === null || x < 0 || x > w) continue;
          const bw = 220;
          const bh = 54;
          const bx = c.place === "left" ? x - bw - 70 : x - bw / 2 - 60;
          const by = c.place === "above" ? y - bh - 46 : c.place === "below" ? y + 46 : y - bh / 2 - 50;
          out.tags.push({ id: c.id, kind: "hint", x, y, ax: x, ay: y, bx: clampX(bx, bw), by: clampY(by, bh), w: bw, text: c.text });
        }
      }
      const key = JSON.stringify(out, (_, v) => (typeof v === "number" ? Math.round(v) : v));
      if (key !== last) {
        last = key;
        setLayout(out);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view, frame, trades, selected, story, analysis, notes, show.trades]);

  /** Scroll the chart to a trade and select it. */
  const goTo = (t: ChartTrade) => {
    setPicked(t.id);
    const ch = chart.current;
    const d = data.current;
    if (!ch || d.length < 2) return;
    const fm = FRAME_MS[frame];
    const from = (t.entryT - d[0].t) / fm;
    const to = ((t.exitT ?? d[d.length - 1].t) - d[0].t) / fm;
    const pad = Math.max(30, (to - from) * 0.6);
    ch.c.timeScale().setVisibleLogicalRange({ from: from - pad, to: to + pad });
  };
  const selIndex = selected ? trades.findIndex((t) => t.id === selected.id) : -1;

  // ---------- render ----------
  const main = { display: "block", maxWidth: "none", height: "100dvh", overflowY: "auto", padding: 0 } as const;
  const walletChange = wallet.equity - start;
  const spark = (pts: { v: number }[], w = 300, h = 54) => {
    if (pts.length < 2) return "";
    const vs = pts.map((p) => p.v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p.v - lo) / (hi - lo || 1)) * (h - 4) - 2}`).join(" ");
  };
  const walletCurve = [{ v: start }, ...wallet.curve, { v: wallet.equity }];

  return (
    <main className={styles.page} style={main}>
      {/* ---------- top: brand, radar of the 12 pairs, next candle ---------- */}
      <header className={styles.top}>
        <a className={styles.logo} href="/trading">KHASROY <b>·</b> trading</a>
        <div className={styles.radar}>
          {radar.map(({ p, mk, a }) => (
            <button key={p} type="button" className={styles.chip} data-on={p === symbol || undefined} onClick={() => setSymbol(p)} title={a ? a.verdict : ""}>
              <span className={styles.chipName}>{short(p)}</span>
              <span className={styles.chipPrice}>{mk ? fp(mk.price) : "…"}</span>
              <span className={styles.chipChange} data-up={(mk?.change ?? 0) >= 0 || undefined}>{mk ? `${sign(mk.change)}%` : ""}</span>
              {a ? <i className={styles.heat} data-side={a.nearest.side} style={{ width: `${Math.round(a.nearest.closeness * 100)}%` }} /> : null}
            </button>
          ))}
        </div>
        <div className={styles.clock} title="Сигналы проверяются после закрытия каждой 4-часовой свечи">
          <small>до закрытия 4ч</small>
          <b>{leftText}</b>
        </div>
      </header>
      {error ? <p className={styles.error}>{error}<button type="button" onClick={() => setError("")}>×</button></p> : null}

      <div className={styles.grid}>
        {/* ---------- center: chart and analysis ---------- */}
        <section className={styles.center}>
          <div className={styles.toolbar}>
            <div className={styles.views}>
              <button type="button" data-on={view === "khasroy" || undefined} onClick={() => setView("khasroy")} title="Хасрой подписывает график и показывает свои сделки">График Хасроя</button>
              <button type="button" data-on={view === "draw" || undefined} onClick={() => setView("draw")} title="График TradingView: линии, уровни, фибо, заметки — панель инструментов слева">✏️ Рисовать (TradingView)</button>
            </div>
            <div className={styles.symbol}>
              <b>{short(symbol)}<span>/USDT · Binance Futures</span></b>
              <strong data-up={(m?.change ?? 0) >= 0 || undefined}>{fp(price)}</strong>
              <em data-up={(m?.change ?? 0) >= 0 || undefined}>{m ? `${sign(m.change)}% за 24ч` : ""}</em>
            </div>
            <div className={styles.frames}>
              {FRAMES.map(([id, label]) => <button key={id} type="button" data-on={frame === id || undefined} onClick={() => setFrame(id)}>{label}</button>)}
            </div>
            {view === "khasroy" ? (
              <div className={styles.toggles}>
                <label title="Границы, за которыми Хасрой входит в сделку"><input type="checkbox" checked={show.channel} onChange={(e) => setShow({ ...show, channel: e.target.checked })} /> коридор</label>
                <label title="Жёлтая — быстрое среднее, фиолетовая — медленное. Жёлтая выше — рынок растёт"><input type="checkbox" checked={show.ema} onChange={(e) => setShow({ ...show, ema: e.target.checked })} /> линии направления</label>
                <label><input type="checkbox" checked={show.trades} onChange={(e) => setShow({ ...show, trades: e.target.checked })} /> сделки</label>
                <label><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> подписи</label>
                <span className={styles.live} data-state={stream}>{stream === "ws" ? "онлайн" : stream === "poll" ? "обновление 5 с" : "…"}</span>
              </div>
            ) : (
              <span className={styles.hint}>инструменты рисования — на панели слева от графика</span>
            )}
          </div>
          <div className={styles.chart} ref={tvBox} hidden={view !== "draw"} />
          <div className={styles.chart} hidden={view !== "khasroy"}>
            <div className={styles.fill} ref={box} />
            {layout ? (
              <div className={styles.overlay}>
                <svg width="100%" height="100%">
                  <defs>
                    <marker id="kh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="#ffc44d" />
                    </marker>
                  </defs>
                  {layout.boxes.map((b) => (
                    <g key={b.id} opacity={b.on ? 1 : 0.45}>
                      <rect x={b.x1} y={Math.min(b.ye, b.yt)} width={b.x2 - b.x1} height={Math.abs(b.yt - b.ye)} fill="rgba(38,208,124,0.22)" stroke={b.on ? GREEN : "none"} strokeWidth="1" />
                      <rect x={b.x1} y={Math.min(b.ye, b.ys)} width={b.x2 - b.x1} height={Math.abs(b.ys - b.ye)} fill="rgba(255,84,104,0.22)" stroke={b.on ? RED : "none"} strokeWidth="1" />
                      <line x1={b.x1} x2={b.x2} y1={b.ye} y2={b.ye} stroke="#d9d4f5" strokeWidth={b.on ? 1.5 : 1} />
                      <text x={b.x1 + 4} y={(b.side === "long" ? Math.min(b.ye, b.yt) : Math.max(b.ye, b.yt)) + (b.side === "long" ? -5 : 13)} fontSize="11" fontWeight="700" fill={b.status === "win" ? GREEN : b.status === "loss" ? RED : "#ffc44d"}>
                        {b.side === "long" ? "ПОКУПКА" : "ПРОДАЖА"} {b.status === "win" ? "✓ цель" : b.status === "loss" ? "✗ стоп" : "⏳ идёт"}{b.live ? " · реальный сигнал" : ""}
                      </text>
                    </g>
                  ))}
                  {layout.tags.map((t) => (
                    <line key={`a-${t.id}`} x1={t.bx + t.w / 2} y1={t.by + 20} x2={t.ax} y2={t.ay} stroke="#ffc44d" strokeWidth="1.3" markerEnd="url(#kh-arrow)" />
                  ))}
                </svg>
                {layout.tags.map((t) =>
                  t.kind === "hint" ? (
                    <div key={t.id} className={styles.note} style={{ left: t.bx, top: t.by, width: t.w }}>
                      <b>Хасрой:</b> {t.text}
                    </div>
                  ) : story && selected ? (
                    <div key={t.id} className={`${styles.note} ${styles.noteTrade}`} style={{ left: t.bx, top: t.by, width: t.w }}>
                      <b>{selected.side === "long" ? "Купил" : "Продал"}: </b>{story.whyShort}.
                      <br /><b>Ждёт: </b>{story.expectShort}.
                      <br /><span data-tone={selected.status}>{story.result}</span>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
          </div>

          {view === "khasroy" && selected && story ? (
            <article className={styles.tradeCard}>
              <header>
                <h2>{selected.live ? "Сделка Хасроя" : "Сделка Хасроя · проверка на прошлом"} · {short(symbol)}</h2>
                <span className={styles.tradeNav}>
                  <button type="button" disabled={selIndex <= 0} onClick={() => goTo(trades[selIndex - 1])}>← раньше</button>
                  <em>{selIndex + 1} из {trades.length}</em>
                  <button type="button" disabled={selIndex >= trades.length - 1} onClick={() => goTo(trades[selIndex + 1])}>позже →</button>
                </span>
              </header>
              <div className={styles.tradeBody}>
                <p><b>{selected.side === "long" ? "Почему купил" : "Почему продал"}.</b> {story.why}</p>
                <p><b>Что ждёт.</b> {story.expect}</p>
                <p className={styles.tradeResult} data-tone={selected.status}>{story.result}</p>
                <div className={styles.progress} data-tone={selected.status}>
                  <span>стоп {fp(selected.sl)}</span>
                  <div><i style={{ left: `${50 + story.progress * 50}%` }} /></div>
                  <span>цель {fp(selected.tp)}</span>
                </div>
              </div>
              <p className={styles.muted}>Нажмите на любую зелёно-красную коробку на графике — Хасрой расскажет про эту сделку. {selected.live ? "" : "Сделки с пометкой «проверка на прошлом» — как правило сработало бы, реальные сигналы подписаны «реальный сигнал»."}</p>
            </article>
          ) : null}

          <div className={styles.lower}>
            <article className={styles.analysis}>
              <header>
                <h2>Анализ Хасроя · {short(symbol)}</h2>
                <span>простыми словами, обновляется вживую</span>
              </header>
              {analysis ? (
                <>
                  <p className={styles.verdict} data-side={analysis.nearest.side}>{analysis.verdict}</p>
                  <div className={styles.meter}>
                    <span>продажа ниже {fp(analysis.breakoutLow)}</span>
                    <div className={styles.track}>
                      <i style={{ left: `${Math.max(0, Math.min(100, ((analysis.price - analysis.breakoutLow) / (analysis.breakoutHigh - analysis.breakoutLow)) * 100))}%` }} />
                    </div>
                    <span>покупка выше {fp(analysis.breakoutHigh)}</span>
                  </div>
                  <ul className={styles.points}>
                    {analysis.points.map((p, i) => <li key={i} data-tone={p.tone}>{p.text}</li>)}
                  </ul>
                  <div className={styles.facts}>
                    <div><small>Направление</small><b data-tone={analysis.trend === "вверх" ? "up" : analysis.trend === "вниз" ? "down" : ""}>{analysis.trend === "боковик" ? "на месте" : analysis.trend}</b></div>
                    <div><small>Рынок движется</small><b>{analysis.volatility === "высокая" ? "резко" : analysis.volatility === "низкая" ? "спокойно" : "обычно"}</b></div>
                    <div><small>Шаг цены за 4ч</small><b>~{analysis.atrPct.toFixed(1)}%</b></div>
                    <div><small>За неделю</small><b data-tone={analysis.change7d >= 0 ? "up" : "down"}>{sign(analysis.change7d)}%</b></div>
                    <div><small>Перевес</small><b>{analysis.funding === null ? "—" : analysis.funding > 0.0003 ? "покупатели" : analysis.funding < -0.0003 ? "продавцы" : "нет"}</b></div>
                  </div>
                </>
              ) : (
                <p className={styles.muted}>Загружаю 4-часовые свечи…</p>
              )}
            </article>

            <article className={styles.history}>
              <header>
                <h2>Проверка на прошлом</h2>
                <span>те же правила, 12 монет</span>
              </header>
              {history ? (
                <>
                  <p className={styles.explain}>
                    Если бы Хасрой торговал по этим правилам последние ~{months(history.path)} мес., начав с {usd(start)} и рискуя {usd(start * risk / 100)} ({risk}%) в каждой сделке, сейчас было бы:
                  </p>
                  <div className={styles.bigNum}>
                    <small>{usd(start)} →</small>
                    <b data-up={history.end >= start || undefined}>{usd(history.end)}</b>
                    <em data-up={history.end >= start || undefined}>{sign(history.end - start)}$</em>
                  </div>
                  <svg className={styles.spark} viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden>
                    <polyline points={spark(history.path)} fill="none" stroke={history.end >= start ? GREEN : RED} strokeWidth="1.6" />
                  </svg>
                  <div className={styles.miniStats}>
                    <span>{history.trades} сделок</span>
                    <span>{Math.round(history.winRate * history.trades)} в плюс</span>
                    <span>{history.trades - Math.round(history.winRate * history.trades)} в минус</span>
                    <span>худшее падение −{history.maxDrawdownPct.toFixed(0)}%</span>
                  </div>
                  <p className={styles.muted}>Почему плюсовых сделок мало: каждая удачная приносит в 3 раза больше, чем теряет неудачная. Поэтому хватает примерно 1 удачной из 4, чтобы быть в нуле. За последние месяцы рынок был неудобный — вышел небольшой минус; на 2022–2026 годах в целом был плюс каждый год. Это прошлое, а не обещание.</p>
                </>
              ) : (
                <p className={styles.muted}>Считаю по истории…</p>
              )}
            </article>
          </div>
        </section>

        {/* ---------- right: journal and paper wallet ---------- */}
        <aside className={styles.side}>
          <section className={styles.panel}>
            <header><h2>Журнал сигналов</h2><span>{journal.length ? `с ${new Date(Date.parse(journal[journal.length - 1].created_at)).toLocaleDateString("ru-RU")}` : "пока пусто"}</span></header>
            <div className={styles.tiles}>
              <div><small>Закрыто</small><b>{wallet.closed}</b></div>
              <div><small>В плюс</small><b>{wallet.closed ? `${Math.round((wallet.wins / wallet.closed) * 100)}%` : "—"}</b></div>
              <div><small>Итог</small><b data-up={wallet.balance >= start || undefined}>{wallet.closed ? `${sign(wallet.balance - start)}$` : "—"}</b></div>
              <div><small>Открыто</small><b>{journal.filter((s) => s.status === "open").length}</b></div>
            </div>
            <ul className={styles.trades}>
              {wallet.trades.length ? wallet.trades.slice(0, 40).map((t) => (
                <li key={t.id} onClick={() => setSymbol(t.symbol)}>
                  <span className={styles.tag} data-side={t.side}>{t.side === "long" ? "LONG" : "SHORT"}</span>
                  <span className={styles.tName}>{short(t.symbol)}<small>{new Date(t.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · вход {fp(t.entry)}</small></span>
                  <span className={styles.tRes} data-state={t.open ? "open" : t.status}>
                    {t.open ? "в работе" : t.status === "win" ? "цель" : t.status === "loss" ? "стоп" : "время"}
                    <b data-up={t.pnl >= 0 || undefined}>{sign(t.pnl)}$</b>
                  </span>
                </li>
              )) : (
                <li className={styles.empty}>Хасрой пришлёт первый сигнал в Telegram, когда 4-часовая свеча закроется за границей коридора. Ближе всех к пробою сейчас: {radar.filter((r) => r.a).sort((a, b) => (b.a?.nearest.closeness ?? 0) - (a.a?.nearest.closeness ?? 0)).slice(0, 3).map((r) => `${short(r.p)} (${r.a?.nearest.side === "long" ? "вверх" : "вниз"})`).join(", ") || "…"}.</li>
              )}
            </ul>
          </section>

          <section className={`${styles.panel} ${styles.wallet}`}>
            <header><h2>Бумажный кошелёк</h2><span>каждый сигнал · риск {risk}%</span></header>
            <div className={styles.bigNum}>
              <small>старт {usd(start)} →</small>
              <b data-up={walletChange >= 0 || undefined}>{usd(wallet.equity)}</b>
              <em data-up={walletChange >= 0 || undefined}>{sign(walletChange)}$ ({sign((walletChange / start) * 100)}%)</em>
            </div>
            <svg className={styles.spark} viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden>
              {walletCurve.length > 2 ? <polyline points={spark(walletCurve)} fill="none" stroke={walletChange >= 0 ? GREEN : RED} strokeWidth="1.6" /> : <line x1="0" y1="27" x2="300" y2="27" stroke="#2a2f3d" strokeDasharray="4 4" />}
            </svg>
            <div className={styles.walletRows}>
              <div><span>Зафиксировано</span><b>{usd(wallet.balance)}</b></div>
              <div><span>Открытые позиции</span><b data-up={wallet.unrealized >= 0 || undefined}>{sign(wallet.unrealized)}$</b></div>
              <div><span>Худшее падение</span><b>{wallet.maxDrawdownPct.toFixed(1)}%</b></div>
            </div>
            <div className={styles.riskSeg}>
              {[0.5, 1].map((r) => <button key={r} type="button" data-on={risk === r || undefined} onClick={() => setRisk(r)}>риск {r}%</button>)}
            </div>
            <p className={styles.muted}>Деньги вымышленные: так видно, что стало бы с {usd(start)} через неделю-две, прежде чем рисковать настоящими. Комиссии Binance учтены.</p>
          </section>
        </aside>
      </div>
      <footer className={styles.foot}>
        Данные Binance USDⓈ-M Futures. Анализ по фиксированным правилам, проверенным на 2022–2026 годах. Не финансовый совет: решение по каждой сделке за вами.
      </footer>
    </main>
  );
}
