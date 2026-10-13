"use client";

// Khasroy studia — the reel editor. Khasroy writes a script; the studio turns it into three
// different looks at once, plays them with sound, and lets the owner edit everything by hand:
// scenes on the storyboard (drag to reorder, drag the edge to change length), each scene's
// words, look and movement, own photos and music. The chosen plan is checked on the server and
// rendered to MP4 on GitHub.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Clapperboard, Copy, Download, Image as ImageIcon, Keyboard, Maximize2, Minimize2,
  Music, Pause, Play, Plus, Redo2, RefreshCw, Repeat, Save, SkipBack, Smartphone, Sparkles, Trash2, Undo2, Upload,
  Volume2, VolumeX, X,
} from "lucide-react";
import { waitLabel } from "@/lib/ai/limits";
import { KINDS, LOOKS, planSources, scriptToPlan, type Script as ComposeScript } from "@/lib/reels/compose";
import { estimateBpm, PREVIEW_RATE } from "@/lib/reels/preview-audio";
import { decodeTrack, usePlayer } from "./use-player";
import styles from "./reels.module.css";

// ---------- types ----------
type Line = { from: "client" | "inna"; text: string };
type Scene = {
  seconds: number;
  kind?: string;
  what: string;
  text: string;
  lines?: Line[];
  question?: string;
  items?: string[];
  before?: string[];
  image?: string;
  [key: string]: unknown;
};
type Script = { title: string; idea: string; scenes: Scene[] };
type PlanScene = { tool: string; duration: number; transition: string; camera?: string; params: Record<string, unknown> };
type Plan = {
  title: string;
  scenes: PlanScene[];
  style?: string;
  bpm?: number;
  seed?: number;
  music?: "on" | "off" | "track";
  track?: string;
  trackOffset?: number;
  theme?: string;
};
type Job = {
  id: string;
  status: "draft" | "queued" | "rendering" | "done" | "failed";
  brief: string;
  title: string;
  script: Script | null;
  plan: Plan | null;
  video_url: string | null;
  error: string | null;
  queued_at: string | null;
  updated_at: string;
};
type ListItem = Pick<Job, "id" | "status" | "title" | "video_url" | "updated_at">;
type Pending = { label: string; run: () => Promise<void> };
type Override = { transition?: string; camera?: string; variant?: string };
type Track = { url: string; name: string; bpm: number; offset: number };
type Asset = { url: string; kind: "image" | "audio"; name: string; created_at: string };
type Snapshot = {
  script: Script | null;
  overrides: Record<number, Override>;
  seeds: number[];
  looks: string[];
  chosen: number;
  sound: string;
  track: Track | null;
  theme: string;
  logo: string;
};
/** Where a picked file goes: a scene's picture (index -1: just browsing), the logo, or the music. */
type PickTarget = { kind: "scene"; index: number } | { kind: "logo" } | { kind: "track" } | null;

// ---------- vocabulary ----------
const KIND_NAMES = Object.keys(KINDS);
const TOOL_KIND: Record<string, string> = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.tool, k]));
const STATUS: Record<Job["status"], string> = { draft: "черновик", queued: "в очереди", rendering: "собирается", done: "готово", failed: "ошибка" };
const SOUND = [
  { id: "pulse", label: "Пульс" },
  { id: "bounce", label: "Бит" },
  { id: "chill", label: "Спокойно" },
  { id: "track", label: "Свой трек" },
  { id: "off", label: "Без" },
];
const THEMES: [string, string][] = [["", "как в образе"], ["brand", "Бренд"], ["night", "Ночь"], ["mono", "Журнал"], ["acid", "Кислота"], ["cinema", "Кино"]];
const TRANSITIONS: Record<string, string> = {
  cut: "склейка", fade: "растворение", slide: "сдвиг", push: "толчок", whip: "рывок", zoom: "зум",
  wipe: "шторка", slab: "плашка", glitch: "сбой", split: "разрез", iris: "круг",
};
const CAMERAS: Record<string, string> = { "": "авто", still: "статично", push: "наезд", pull: "отъезд", panL: "панорама ←", panR: "панорама →", tilt: "наклон", drift: "дрейф" };
const VARIANTS: Record<string, [string, string][]> = {
  headline: [["stack", "строки"], ["block", "плашка"], ["giant", "крупно"]],
  counter: [["corner", "в углу"], ["ring", "кольцо"]],
  notification: [["float", "на фоне"], ["phone", "в телефоне"]],
  chat: [["bare", "на фоне"], ["phone", "в телефоне"]],
  photo: [["full", "весь экран"], ["card", "снимок"], ["phone", "в телефоне"]],
};
const BG: Record<string, [string, string]> = { cream: ["#ebe6dc", "#111"], black: ["#0b0b0d", "#fff"], violet: ["#8853fd", "#fff"] };
const THEME_BG: Record<string, Record<string, [string, string]>> = {
  night: { cream: ["#15121f", "#fff"], violet: ["#2a1b5c", "#fff"] },
  mono: { violet: ["#0b0b0d", "#fff"], black: ["#ece8df", "#111"] },
  acid: { cream: ["#f6f4ee", "#111"], violet: ["#c6ff3d", "#111"] },
};
const CHIPS = ["смелее", "короче", "больше переписки", "резче крючок", "добавь юмора"];
const EXAMPLES = [
  "Рилс: ИИнна понимает голосовые — клиент наговорил заказ, она ответила и оформила",
  "Рилс про то, что владелец больше не сидит в директе 24/7",
  "Рилс: клиент просит скидку, ИИнна спрашивает владельца кнопками Да/Нет",
];
const NEEDS_IMAGE = new Set(["фото", "товар", "экран"]);
const KEYS: [string, string][] = [
  ["Пробел", "пуск / пауза"],
  ["← →", "на долю такта"],
  ["Shift + ← →", "на соседнюю сцену"],
  ["L", "повтор выбранной сцены"],
  ["Ctrl/⌘ + Z", "отменить"],
  ["Ctrl/⌘ + Shift + Z", "вернуть"],
  ["Ctrl/⌘ + S", "сохранить"],
  ["D", "дублировать сцену"],
  ["Delete", "удалить сцену"],
  ["F", "фокус на превью"],
  ["G", "зоны интерфейса Reels"],
  ["?", "эта подсказка"],
];

const DEMO: Script = {
  title: "Пока вы спите",
  idea: "Пример сценария: ночью директ разрывается, ИИнна отвечает сама, решения остаются владельцу",
  scenes: [
    { seconds: 2, kind: "завал", text: "Директ *разрывается*", what: "Вопросы сыплются кучей", items: ["Сколько стоит?", "Есть размер M?", "Доставка есть?"] },
    { seconds: 1.3, kind: "удар", text: "СТОП.", what: "Поворот" },
    { seconds: 2.6, kind: "ночь", text: "Пока вы *спите*", what: "Часы бегут через ночь", label: "ИИнна на связи" },
    { seconds: 4, kind: "голосовое", text: "Слушаю", what: "Голосовое клиента", lines: [{ from: "client", text: "Нужен *чёрный* на подарок" }, { from: "inna", text: "Есть! Успеем на завтра :)" }] },
    { seconds: 3, kind: "выбор", text: "Решаете *вы*", what: "Скидку решает владелец", question: "Клиент просит скидку. Согласны?" },
    { seconds: 2.2, kind: "реакция", text: "Заказ!", what: "Салют" },
    { seconds: 2.6, kind: "смена слов", text: "ИИнна", what: "Что она делает", items: ["отвечает", "продаёт", "напоминает"] },
    { seconds: 2.6, kind: "концовка", text: "Ссылка в профиле", what: "Логотип", label: "Отвечает клиентам 24/7" },
  ],
};

// ---------- helpers ----------
const linesToText = (lines?: Line[]) => (lines ?? []).map((l) => `${l.from === "client" ? "Клиент" : "ИИнна"}: ${l.text}`).join("\n");
const textToLines = (value: string): Line[] =>
  value.split("\n").map((r) => r.trim()).filter(Boolean).map((row) => {
    const m = /^(клиент|client|иинна|inna|я)\s*:\s*(.*)$/iu.exec(row);
    return m ? { from: /^(клиент|client)$/iu.test(m[1]) ? ("client" as const) : ("inna" as const), text: m[2] } : { from: "client" as const, text: row };
  });
const toList = (v: string, max: number) => v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, max);
const newSeed = () => Math.floor(Math.random() * 1_000_000);
const fmt = (s: number) => s.toFixed(1).replace(".", ",");
const plain = (v: unknown) => (typeof v === "string" ? v.replace(/\*/g, "").replace(/\n/g, " ") : "");
const sceneLabel = (s: PlanScene) =>
  plain(s.params.text) || plain(s.params.headline) || plain(s.params.title) || plain(s.params.prefix) || plain(s.params.line) || plain(s.params.name) || plain(s.params.value) || TOOL_KIND[s.tool] || s.tool;
const LOOK_BY_THEME: Record<string, string> = Object.fromEntries(LOOKS.map((l) => [l.theme, l.id]));
const lookName = (id: string) => LOOKS.find((l) => l.id === id)?.name ?? id;
function pickLooks(avoid: string[] = [], first?: string): string[] {
  const ids = LOOKS.map((l) => l.id).sort(() => Math.random() - 0.5);
  const fresh = ids.filter((id) => !avoid.includes(id) && id !== first);
  const rest = ids.filter((id) => avoid.includes(id) && id !== first);
  return [...(first ? [first] : []), ...fresh, ...rest].slice(0, 3);
}
const sceneColors = (theme: string | undefined, bg: unknown, tool: string): [string, string] => {
  if (tool === "night") return ["#2a1f55", "#fff"];
  if (tool === "photo") return ["#1b1b22", "#fff"];
  const key = String(bg || "black");
  return THEME_BG[theme ?? ""]?.[key] ?? BG[key] ?? BG.black;
};
const runtimeUrl = (plan: Plan, still?: number) =>
  `/reels-runtime/index.html${still === undefined ? "" : `?still=${still.toFixed(2)}`}#${encodeURIComponent(JSON.stringify(plan))}`;

async function api<T>(body: Record<string, unknown> | null, query = ""): Promise<T> {
  const response = await fetch(`/api/owner/reels${query}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; retryAt?: number };
  if (response.status === 429 && data.retryAt) throw Object.assign(new Error(data.error || "лимит"), { retryAt: data.retryAt });
  if (response.status === 401) throw Object.assign(new Error("Войдите в консоли владельца."), { unauthorized: true });
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

/** Value that follows `value` only after it stops changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

// =============================================================================================
export default function ReelsStudio() {
  // ---------- document state (undoable) ----------
  const [script, setScript] = useState<Script | null>(null);
  const [seeds, setSeeds] = useState<number[]>(() => [newSeed(), newSeed(), newSeed()]);
  const [looks, setLooks] = useState<string[]>(() => pickLooks());
  const [chosen, setChosen] = useState(0);
  const [sound, setSound] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const [theme, setTheme] = useState("");
  const [logo, setLogo] = useState("");
  const [overrides, setOverrides] = useState<Record<number, Override>>({});

  // ---------- session state ----------
  const [brief, setBrief] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [demo, setDemo] = useState(false);
  const [list, setList] = useState<ListItem[]>([]);
  const [waiting, setWaiting] = useState<{ until: number; pending: Pending } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<"studio" | "done" | "queue">("studio");
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"preview" | "video">("preview");
  const [focus, setFocus] = useState(false);
  const [safe, setSafe] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picker, setPicker] = useState<PickTarget>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState("");

  const say = (text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? "" : t)), 2400);
  };

  // ---------- undo / redo over the whole document ----------
  const snapJson = JSON.stringify({ script, overrides, seeds, looks, chosen, sound, track, theme, logo } satisfies Snapshot);
  const history = useRef<{ past: string[]; future: string[]; last: string; restoring: boolean }>({ past: [], future: [], last: "", restoring: false });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  useEffect(() => {
    const h = history.current;
    if (h.restoring) {
      h.restoring = false;
      h.last = snapJson;
      return;
    }
    const t = setTimeout(() => {
      if (h.last && h.last !== snapJson) {
        h.past.push(h.last);
        if (h.past.length > 120) h.past.shift();
        h.future = [];
      }
      h.last = snapJson;
      setHistorySize({ past: h.past.length, future: h.future.length });
    }, 450);
    return () => clearTimeout(t);
  }, [snapJson]);
  const restore = (json: string) => {
    const s = JSON.parse(json) as Snapshot;
    history.current.restoring = true;
    setScript(s.script);
    setOverrides(s.overrides);
    setSeeds(s.seeds);
    setLooks(s.looks);
    setChosen(s.chosen);
    setSound(s.sound);
    setTrack(s.track);
    setTheme(s.theme);
    setLogo(s.logo);
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(h.last || snapJson);
    restore(prev);
    setHistorySize({ past: h.past.length, future: h.future.length });
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(h.last || snapJson);
    restore(next);
    setHistorySize({ past: h.past.length, future: h.future.length });
  };

  // ---------- loading ----------
  const refreshList = useCallback(() => {
    api<{ jobs: ListItem[] }>(null).then((d) => setList(d.jobs)).catch((e: { unauthorized?: boolean }) => { if (e.unauthorized) setUnauthorized(true); });
  }, []);
  const refreshAssets = useCallback(() => {
    api<{ assets: Asset[] }>(null, "?assets=1").then((d) => setAssets(d.assets ?? [])).catch(() => undefined);
  }, []);

  const openJob = useCallback((next: Job | null, keepLook = false) => {
    setJob(next);
    if (!next) return;
    setBrief(next.brief || "");
    setScript(next.script);
    if (!keepLook) {
      const p = next.plan;
      setSeeds([p?.seed ?? newSeed(), newSeed(), newSeed()]);
      setLooks(pickLooks([], p?.theme ? LOOK_BY_THEME[p.theme] : undefined));
      setChosen(0);
      setTheme("");
      setOverrides({});
      if (p?.music === "track" && p.track) {
        setSound("track");
        setTrack({ url: p.track, name: "свой трек", bpm: p.bpm ?? 120, offset: p.trackOffset ?? 0 });
      } else {
        setSound(p ? (p.music === "off" ? "off" : p.style || "") : "");
        setTrack(null);
      }
      const outro = p?.scenes.find((s) => s.tool === "outro");
      setLogo(typeof outro?.params.logo === "string" ? outro.params.logo : "");
      setView(next.status === "done" && next.video_url ? "video" : "preview");
    }
    const url = new URL(window.location.href);
    url.searchParams.set("job", next.id);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    // ?demo — a sample script and no server calls, to try the editor without signing in.
    if (params.has("demo")) {
      setDemo(true);
      setBrief(DEMO.idea);
      setScript(DEMO);
      return;
    }
    refreshList();
    refreshAssets();
    const id = params.get("job");
    if (id) api<{ job: Job | null }>(null, `?id=${id}`).then((d) => openJob(d.job)).catch(() => undefined);
    const fromChat = params.get("brief");
    if (!id && fromChat) setBrief(fromChat.slice(0, 2000));
  }, [refreshList, refreshAssets, openJob]);

  // Follow a reel while GitHub renders it.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "rendering")) return;
    const timer = setInterval(() => {
      api<{ job: Job | null }>(null, `?id=${job.id}`)
        .then((d) => {
          if (d.job && d.job.status !== job.status) {
            setJob(d.job);
            if (d.job.status === "done") {
              setView("video");
              say("Видео готово");
            }
            refreshList();
          }
        })
        .catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [job, refreshList]);

  // Out of model limits: wait, then repeat the same step on its own.
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [waiting]);
  useEffect(() => {
    if (!waiting || busy || now < waiting.until) return;
    const { pending } = waiting;
    setWaiting(null);
    void pending.run();
  }, [now, waiting, busy]);

  async function step(label: string, run: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await run();
    } catch (err) {
      const e = err as Error & { retryAt?: number; unauthorized?: boolean };
      if (e.unauthorized && !demo) setUnauthorized(true);
      if (e.retryAt) setWaiting({ until: e.retryAt, pending: { label, run: () => step(label, run) } });
      else setError(demo ? "В демо сервер недоступен: войдите в консоли, чтобы писать сценарии, сохранять и собирать видео." : e.message);
    } finally {
      setBusy("");
    }
  }

  const writeScript = (note?: string) =>
    step(note ? "Хасрой переписывает сценарий…" : "Хасрой пишет сценарий…", async () => {
      if (demo) throw Object.assign(new Error("demo"), { unauthorized: true });
      const d = await api<{ job: Job }>({
        action: "script",
        id: job && job.status !== "queued" && job.status !== "rendering" ? job.id : undefined,
        brief,
        previous: note ? script : undefined,
        feedback: note || undefined,
      });
      openJob(d.job, true);
      setSeeds([newSeed(), newSeed(), newSeed()]);
      setLooks((old) => pickLooks(old));
      setChosen(0);
      setOverrides({});
      setFeedback("");
      setView("preview");
      setSelected(0);
      refreshList();
    });

  // ---------- variants, built right here in the browser ----------
  const variants = useMemo(() => {
    if (!script?.scenes.length) return [];
    const style = sound && sound !== "off" && sound !== "track" ? sound : undefined;
    const own = sound === "track" && track ? track : null;
    return seeds.map((seed, i) => {
      const checked = scriptToPlan(script as unknown as ComposeScript, seed, {
        style,
        look: looks[i],
        bpm: own?.bpm,
        theme: theme || undefined,
        logo: logo || undefined,
      });
      const plan = checked.plan as unknown as Plan;
      if (sound === "off") plan.music = "off";
      if (own) {
        plan.music = "track";
        plan.track = own.url;
        plan.trackOffset = own.offset;
      }
      return { plan, fixes: checked.fixes, errors: checked.errors };
    });
  }, [script, seeds, looks, sound, track, theme, logo]);
  const sources = useMemo(() => (script ? planSources(script as unknown as ComposeScript) : []), [script]);

  const current = variants[chosen] ?? variants[0];
  const plan: Plan | null = useMemo(() => {
    if (!current) return job?.plan ?? null;
    return {
      ...current.plan,
      scenes: current.plan.scenes.map((s, i) => {
        const o = overrides[i];
        if (!o) return s;
        return {
          ...s,
          transition: i === 0 ? s.transition : o.transition ?? s.transition,
          camera: o.camera === undefined ? s.camera : o.camera || undefined,
          params: o.variant ? { ...s.params, variant: o.variant } : s.params,
        };
      }),
    };
  }, [current, overrides, job]);
  const planJson = plan ? JSON.stringify(plan) : "";
  const thumbPlanJson = useSettled(planJson, 900);
  const thumbPlan = useMemo(() => (thumbPlanJson ? (JSON.parse(thumbPlanJson) as Plan) : null), [thumbPlanJson]);
  const saved = Boolean(job?.plan && planJson === JSON.stringify(job.plan));
  const total = plan ? plan.scenes.reduce((n, s) => n + s.duration, 0) : 0;
  const beat = plan?.bpm ? 60 / plan.bpm : 0;
  const starts = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const s of plan?.scenes ?? []) {
      out.push(acc);
      acc += s.duration;
    }
    return out;
  }, [plan]);
  const repeats = plan ? plan.scenes.filter((s, i) => i > 1 && s.transition === plan.scenes[i - 1].transition).length : 0;
  const missingImages = script ? script.scenes.filter((s) => s.kind === "фото" && !s.image).length : 0;

  // ---------- player ----------
  const player = usePlayer(plan, planJson);
  const { time, seek, playing } = player;
  const dur = player.duration || total;
  const sel = plan?.scenes[Math.min(selected, Math.max(0, (plan?.scenes.length ?? 1) - 1))];
  const selSource = sources[selected] ?? -1;
  const selScene = script && selSource >= 0 ? script.scenes[selSource] : null;
  const dragRef = useRef<{ mode: "move" | "size" | "scrub"; index: number; x0: number; moved: boolean; start: number } | null>(null);

  // The selected scene follows the playhead (except while a scene is being dragged).
  useEffect(() => {
    if (!plan || (dragRef.current && dragRef.current.mode !== "scrub")) return;
    let i = 0;
    starts.forEach((s0, k) => { if (s0 <= time + 0.001) i = k; });
    if (i !== selected) setSelected(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);
  useEffect(() => {
    if (player.loop && plan && sel) player.setLoop([starts[selected], starts[selected] + sel.duration]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, planJson]);

  const selectScene = (i: number) => {
    if (!plan) return;
    const k = Math.max(0, Math.min(plan.scenes.length - 1, i));
    setSelected(k);
    seek(starts[k] + Math.min(0.5, plan.scenes[k].duration * 0.4));
  };

  // ---------- editing ----------
  const editScript = (patch: Partial<Script>) => script && setScript({ ...script, ...patch });
  const editScene = (i: number, patch: Partial<Scene>) => {
    if (!script || i < 0) return;
    setScript({ ...script, scenes: script.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  };
  const setScenes = (scenes: Scene[]) => {
    if (!script) return;
    setScript({ ...script, scenes });
    setOverrides({});
  };
  /** Moves a plan scene to position `to` on the storyboard (the ending stays last). */
  const moveScene = (from: number, to: number) => {
    if (!script || from === to) return;
    const order = sources.filter((s) => s >= 0);
    const src = sources[from];
    if (src === undefined || src < 0) return;
    order.splice(order.indexOf(src), 1);
    const ending = order.length && script.scenes[order[order.length - 1]].kind === "концовка" ? order.pop() : undefined;
    const at = Math.max(0, Math.min(order.length, to > from ? to - 1 : to));
    order.splice(at, 0, src);
    if (ending !== undefined) order.push(ending);
    const dropped = script.scenes.map((_, i) => i).filter((i) => !order.includes(i));
    setScenes([...order, ...dropped].map((i) => script.scenes[i]));
    setSelected(at);
  };
  const deleteScene = (planIndex: number) => {
    const src = sources[planIndex];
    if (!script || src === undefined || src < 0) return;
    setScenes(script.scenes.filter((_, k) => k !== src));
    setSelected(Math.max(0, planIndex - 1));
    say("Сцена удалена · Ctrl+Z — вернуть");
  };
  const duplicateScene = (planIndex: number) => {
    const src = sources[planIndex];
    if (!script || src === undefined || src < 0) return;
    const scenes = [...script.scenes];
    scenes.splice(src + 1, 0, JSON.parse(JSON.stringify(scenes[src])) as Scene);
    setScenes(scenes);
    setSelected(planIndex + 1);
  };
  const addScene = (kind: string) => {
    const base: Scene = { seconds: 2.6, kind, what: "", text: kind === "удар" ? "ДА." : kind === "реакция" ? "Ура!" : kind === "концовка" ? "Ссылка в профиле" : "Новая сцена" };
    const scenes = [...(script?.scenes ?? [])];
    // New scenes go after the selected one, never after the ending.
    const src = sources[selected];
    let at = src !== undefined && src >= 0 ? src + 1 : scenes.length;
    if (at >= scenes.length && scenes.length && scenes[scenes.length - 1].kind === "концовка" && kind !== "концовка") at = scenes.length - 1;
    scenes.splice(at, 0, base);
    if (!script) setScript({ title: "Новый рилс", idea: "", scenes });
    else setScenes(scenes);
    setAddOpen(false);
    const idx = planSources({ title: "", idea: "", scenes } as unknown as ComposeScript).indexOf(at);
    if (idx >= 0) setSelected(idx);
    if (kind === "фото") setPicker({ kind: "scene", index: at });
  };
  const override = (patch: Override) => setOverrides((o) => ({ ...o, [selected]: { ...o[selected], ...patch } }));
  const newVariants = () => {
    setSeeds([newSeed(), newSeed(), newSeed()]);
    setLooks((old) => pickLooks(old));
    setChosen(0);
    setOverrides({});
  };
  /** New moves for every scene of the chosen variant, keeping its look and words. */
  const shuffleMoves = () => {
    if (!plan) return;
    const moves = Object.keys(TRANSITIONS).filter((t) => t !== "cut");
    const cams = Object.keys(CAMERAS).filter(Boolean);
    const next: Record<number, Override> = {};
    let last = "";
    plan.scenes.forEach((_, i) => {
      const cam = cams[Math.floor(Math.random() * cams.length)];
      if (i === 0) {
        next[i] = { ...overrides[i], camera: cam };
        return;
      }
      const pool = moves.filter((m) => m !== last);
      last = pool[Math.floor(Math.random() * pool.length)];
      next[i] = { ...overrides[i], transition: last, camera: cam };
    });
    setOverrides(next);
  };

  // ---------- storyboard drag: reorder, change length, scrub ----------
  const trackRef = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const xToTime = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur;
  };
  const timeToIndex = (t: number) => {
    let k = 0;
    starts.forEach((s0, i) => { if (s0 <= t) k = i; });
    return k;
  };
  const capture = (e: ReactPointerEvent<HTMLElement>) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone: the drag still works while it stays over the strip */
    }
  };
  const onCellDown = (e: ReactPointerEvent<HTMLElement>, i: number, mode: "move" | "size") => {
    e.stopPropagation();
    capture(e);
    const src = sources[i];
    const start = mode === "size" && script && src >= 0 ? Number(script.scenes[src].seconds) || 2 : 0;
    dragRef.current = { mode, index: i, x0: e.clientX, moved: false, start };
  };
  const onCellMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.mode === "scrub" || !(e.buttons & 1)) return;
    e.stopPropagation();
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 6) return;
    d.moved = true;
    if (d.mode === "move") {
      if (sources[d.index] < 0) return;
      const t = xToTime(e.clientX);
      const k = timeToIndex(t);
      const mid = starts[k] + (plan?.scenes[k].duration ?? 0) / 2;
      setDropAt(t > mid ? k + 1 : k);
    } else {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const secs = Math.max(1, Math.min(6, Math.round((d.start + (dx / r.width) * dur) * 10) / 10));
      const src = sources[d.index];
      if (src >= 0 && script && script.scenes[src].seconds !== secs) editScene(src, { seconds: secs });
    }
  };
  const onCellUp = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    e.stopPropagation();
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) selectScene(i);
    else if (d.mode === "move" && dropAt !== null) moveScene(d.index, dropAt);
    setDropAt(null);
  };
  const onScrubDown = (e: ReactPointerEvent<HTMLElement>) => {
    capture(e);
    dragRef.current = { mode: "scrub", index: 0, x0: e.clientX, moved: true, start: 0 };
    seek(xToTime(e.clientX));
  };
  const onScrubMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.mode === "scrub" && e.buttons & 1) seek(xToTime(e.clientX));
  };
  const onScrubUp = () => {
    if (dragRef.current?.mode === "scrub") dragRef.current = null;
  };

  // ---------- media: upload and pick ----------
  const fileInput = useRef<HTMLInputElement>(null);
  const applyPick = async (asset: { url: string; kind: string; name: string }, target: PickTarget = picker) => {
    setPicker(null);
    if (!target) return;
    if (target.kind === "track" || asset.kind === "audio") {
      setUploading("Слушаю трек и ищу темп…");
      try {
        const samples = await decodeTrack(asset.url);
        const bpm = estimateBpm(samples.subarray(0, Math.min(samples.length, PREVIEW_RATE * 40)), PREVIEW_RATE);
        setTrack({ url: asset.url, name: asset.name, bpm, offset: 0 });
        setSound("track");
        setOverrides({});
        say(`Трек подключён · ${bpm} BPM`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Трек не открылся");
      } finally {
        setUploading("");
      }
      return;
    }
    if (target.kind === "logo") setLogo(asset.url);
    else if (target.index >= 0) editScene(target.index, { image: asset.url });
  };
  const upload = async (file: File) => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const target = picker;
    if (demo) {
      setError("В демо загрузка недоступна: войдите в консоли.");
      return;
    }
    if (file.size > 60 * 1024 * 1024) {
      setError("Файл больше 60 МБ.");
      return;
    }
    setUploading(`Загружаю «${file.name}»…`);
    try {
      const signed = await api<{ uploadUrl: string; publicUrl: string; kind: string; contentType: string }>({ action: "asset_url", ext, name: file.name });
      const res = await fetch(signed.uploadUrl, { method: "PUT", headers: { "content-type": signed.contentType }, body: file });
      if (!res.ok) throw new Error(`Загрузка не прошла (${res.status})`);
      const asset = { url: signed.publicUrl, kind: signed.kind as Asset["kind"], name: file.name, created_at: new Date().toISOString() };
      setAssets((a) => [asset, ...a]);
      setUploading("");
      if (target && !(target.kind === "scene" && target.index < 0)) await applyPick(asset, target);
    } catch (e) {
      setUploading("");
      setError(e instanceof Error ? e.message : "Загрузка не прошла");
    }
  };

  // ---------- saving and rendering ----------
  const saveDraft = async () => {
    if (!plan || !script) throw new Error("Нечего сохранять");
    if (demo) throw Object.assign(new Error("demo"), { unauthorized: true });
    const d = await api<{ job: Job }>({ action: "plan", id: job && job.status !== "queued" && job.status !== "rendering" ? job.id : undefined, brief, script, plan });
    return d.job;
  };
  const savePlan = () =>
    step("Сохраняю…", async () => {
      openJob(await saveDraft(), true);
      refreshList();
      say("Сохранено");
    });
  const render = () =>
    step("Сохраняю и ставлю в очередь…", async () => {
      const draft = await saveDraft();
      const q = await api<{ job: Job }>({ action: "render", id: draft.id });
      openJob(q.job, true);
      refreshList();
      say("В очереди на сборку");
    });
  const reset = () => {
    player.pause();
    setJob(null);
    setScript(null);
    setBrief("");
    setOverrides({});
    setTrack(null);
    setSound("");
    setTheme("");
    setLogo("");
    setTab("studio");
    window.history.replaceState(null, "", "/owner/reels");
  };
  const toggleLoop = () => player.setLoop(player.loop || !sel ? null : [starts[selected], starts[selected] + sel.duration]);

  // ---------- keyboard ----------
  const keys = useRef<Record<string, () => void>>({});
  keys.current = {
    toggle: () => player.toggle(),
    left: () => seek(time - (beat || 0.1)),
    right: () => seek(time + (beat || 0.1)),
    prev: () => selectScene(selected - 1),
    next: () => selectScene(selected + 1),
    loop: toggleLoop,
    undo,
    redo,
    save: () => void savePlan(),
    dup: () => duplicateScene(selected),
    del: () => deleteScene(selected),
    focus: () => setFocus((f) => !f),
    safe: () => setSafe((s) => !s),
    help: () => setShowKeys((s) => !s),
    esc: () => { setShowKeys(false); setPicker(null); setAddOpen(false); },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) k.redo(); else k.undo(); return; }
      if (mod && e.code === "KeyY") { e.preventDefault(); k.redo(); return; }
      if (mod && e.code === "KeyS") { e.preventDefault(); k.save(); return; }
      if (e.key === "Escape") { k.esc(); return; }
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable]") || mod || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) (e.key === "ArrowLeft" ? k.prev : k.next)();
        else (e.key === "ArrowLeft" ? k.left : k.right)();
        return;
      }
      if (e.key === "?") { k.help(); return; }
      const map: Record<string, () => void> = { Space: k.toggle, KeyL: k.loop, KeyD: k.dup, KeyF: k.focus, KeyG: k.safe, Delete: k.del, Backspace: k.del };
      const fn = map[e.code];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The preview and thumbnails scale the 1080×1920 runtime to whatever size they get.
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-fit]");
    const ro = new ResizeObserver((entries) => entries.forEach((e) => {
      const n = e.target as HTMLElement;
      n.style.setProperty("--s", String(n.clientWidth / 1080));
    }));
    nodes.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  });

  const done = list.filter((r) => r.status === "done");
  const queue = list.filter((r) => r.status === "queued" || r.status === "rendering");
  const rendering = job?.status === "queued" || job?.status === "rendering";
  const pill = uploading || busy || (waiting ? `Жду лимит · ${waitLabel(waiting.until - now)}` : rendering ? (job?.status === "queued" ? "В очереди на сборку" : "Видео собирается") : demo ? "Демо без сервера" : "Хасрой готов");
  const main = { display: "flex", flexDirection: "column", maxWidth: "none", padding: 0, height: "100dvh" } as const;
  const soundLabel = (p: Plan) => (p.music === "track" ? "свой трек" : p.music === "off" ? "без музыки" : SOUND.find((s) => s.id === p.style)?.label ?? p.style);
  const assetKind = picker?.kind === "track" ? "audio" : "image";
  const shownAssets = assets.filter((a) => a.kind === assetKind);

  if (unauthorized) {
    return (
      <main className={styles.page} style={main}>
        <div className={styles.gate}>
          <p>Khasroy studia доступна только владельцу.</p>
          <a className={styles.cta} href="/owner">Войти в консоли</a>
          <a className={styles.ghostLink} href="/owner/reels?demo">Посмотреть демо без входа</a>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} style={main} data-focus={focus || undefined}>
      {/* ---------------- top bar ---------------- */}
      <header className={styles.top}>
        <a href="/owner" className={styles.back} aria-label="Консоль"><ArrowLeft size={16} /></a>
        <div className={styles.logo}>KHASROY <b>·</b> studia</div>
        <nav className={styles.tabs}>
          <button type="button" data-on={tab === "studio" || undefined} onClick={() => setTab("studio")}>{job ? "Ролик" : "Новый ролик"}</button>
          <button type="button" data-on={tab === "done" || undefined} onClick={() => setTab("done")}>Готовые · {done.length}</button>
          <button type="button" data-on={tab === "queue" || undefined} onClick={() => setTab("queue")}>Очередь · {queue.length}</button>
        </nav>
        <div className={styles.tools}>
          <button type="button" onClick={undo} disabled={!historySize.past} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={15} /></button>
          <button type="button" onClick={redo} disabled={!historySize.future} title="Вернуть (Ctrl+Shift+Z)" aria-label="Вернуть"><Redo2 size={15} /></button>
          <button type="button" onClick={() => setPicker({ kind: "scene", index: selScene && NEEDS_IMAGE.has(selScene.kind || "") ? selSource : -1 })} title="Медиатека" aria-label="Медиатека"><ImageIcon size={15} /></button>
          <button type="button" onClick={() => void savePlan()} disabled={!plan || !!busy || rendering} title="Сохранить (Ctrl+S)" aria-label="Сохранить"><Save size={15} /></button>
          <button type="button" onClick={() => setShowKeys(true)} title="Клавиши (?)" aria-label="Клавиши"><Keyboard size={15} /></button>
        </div>
        <div className={styles.right}>
          <span className={styles.pill} data-busy={Boolean(busy || uploading || waiting || rendering) || undefined}><i />{pill}</span>
          {job ? <button type="button" className={styles.pillBtn} onClick={reset}><Plus size={14} /> Новый</button> : null}
          <button type="button" className={styles.cta} disabled={!plan || !script || !!busy || rendering || !!current?.errors.length || missingImages > 0} onClick={() => void render()} title={missingImages ? "Добавьте фото в сцены «фото»" : undefined}>
            <Clapperboard size={16} /> {job?.status === "done" && saved ? "Собрать заново" : "Собрать видео"}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Закрыть"><X size={14} /></button></p> : null}
      {waiting ? (
        <div className={styles.wait} role="status">
          <b>Лимит моделей закончился — жду.</b> Повторю сам в {new Date(waiting.until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.
          <button type="button" onClick={() => setWaiting(null)}>Отменить</button>
        </div>
      ) : null}

      {tab !== "studio" ? (
        <section className={styles.library}>
          {(tab === "done" ? done : queue).length ? (
            (tab === "done" ? done : queue).map((r) => (
              <button key={r.id} type="button" className={styles.libCard} onClick={() => api<{ job: Job | null }>(null, `?id=${r.id}`).then((d) => { openJob(d.job); setTab("studio"); })}>
                {r.video_url ? <video src={`${r.video_url}#t=1`} muted playsInline preload="metadata" /> : <div className={styles.libEmpty}><span className={styles.pulse} /></div>}
                <b>{r.title || "Без названия"}</b>
                <span className={styles.badge} data-status={r.status}>{STATUS[r.status]}</span>
              </button>
            ))
          ) : (
            <p className={styles.muted}>{tab === "done" ? "Готовых роликов пока нет." : "Очередь пуста."}</p>
          )}
        </section>
      ) : (
        <>
          <div className={styles.main}>
            {/* ---------------- left: brief and script ---------------- */}
            <section className={`${styles.col} ${styles.left}`}>
              <h3>Задача</h3>
              <textarea className={styles.brief} value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="О чём ролик? Например: ИИнна понимает голосовые" />
              {!brief && !script ? (
                <div className={styles.examples}>{EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setBrief(x)}>{x}</button>)}</div>
              ) : null}
              <button type="button" className={styles.write} disabled={!brief.trim() || !!busy || rendering} onClick={() => void writeScript()}>
                <Sparkles size={15} /> {script ? "Написать заново" : "Написать сценарий"}
              </button>
              {script ? (
                <>
                  <div className={styles.chips}>
                    {CHIPS.map((c) => <button key={c} type="button" disabled={!!busy || rendering} onClick={() => void writeScript(c)}>{c}</button>)}
                  </div>
                  <form className={styles.feedback} onSubmit={(e) => { e.preventDefault(); if (feedback.trim()) void writeScript(feedback.trim()); }}>
                    <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Своя правка для Хасроя…" aria-label="Правка к сценарию" />
                    <button type="submit" disabled={!feedback.trim() || !!busy || rendering} aria-label="Переписать"><RefreshCw size={14} /></button>
                  </form>
                  <h3>Сценарий · {plan?.scenes.length ?? 0} сцен · {fmt(total)} с</h3>
                  <input className={styles.title} value={script.title} onChange={(e) => editScript({ title: e.target.value })} aria-label="Название ролика" />
                  <ol className={styles.scenes}>
                    {plan?.scenes.map((s, i) => {
                      const src = sources[i];
                      const sc = src >= 0 ? script.scenes[src] : null;
                      const needs = sc?.kind === "фото" && !sc.image;
                      return (
                        <li key={i} data-on={selected === i || undefined}>
                          <button type="button" className={styles.sceneRow} onClick={() => selectScene(i)}>
                            <i>{String(i + 1).padStart(2, "0")}</i>
                            <span>{sceneLabel(s) || "—"}<small>{TOOL_KIND[s.tool] ?? s.tool}{needs ? " · нужно фото" : ""}{src < 0 ? " · авто" : ""}</small></span>
                            <em>{fmt(s.duration)}</em>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : null}
              <div className={styles.addWrap}>
                <button type="button" className={styles.addScene} onClick={() => setAddOpen(!addOpen)}><Plus size={14} /> Сцена</button>
                {addOpen ? (
                  <div className={styles.kindMenu}>
                    {KIND_NAMES.map((k) => <button key={k} type="button" onClick={() => addScene(k)} title={KINDS[k].hint}>{k}</button>)}
                  </div>
                ) : null}
              </div>
            </section>

            {/* ---------------- center: preview and variants ---------------- */}
            <section className={styles.stage}>
              {job?.video_url ? (
                <div className={styles.viewSwitch}>
                  <button type="button" data-on={view === "preview" || undefined} onClick={() => setView("preview")}>Превью</button>
                  <button type="button" data-on={view === "video" || undefined} onClick={() => { player.pause(); setView("video"); }}>Готовое видео</button>
                </div>
              ) : null}
              <div className={styles.stageRow}>
                <div className={styles.phone} data-fit>
                  {view === "video" && job?.video_url ? (
                    <video src={job.video_url} controls playsInline autoPlay />
                  ) : plan ? (
                    <>
                      <iframe ref={player.frame} title="Превью рилса" src="/reels-runtime/index.html" onLoad={player.onFrameLoad} />
                      {safe ? (
                        <div className={styles.safe} aria-hidden>
                          <div className={styles.safeTop}>шапка Reels</div>
                          <div className={styles.safeSide}>♡<br />✉<br />↗</div>
                          <div className={styles.safeBottom}>ник · подпись · музыка</div>
                        </div>
                      ) : null}
                      {selScene?.kind === "фото" && !selScene.image ? (
                        <button type="button" className={styles.needPhoto} onClick={() => setPicker({ kind: "scene", index: selSource })}><Upload size={16} /> Добавить фото</button>
                      ) : null}
                    </>
                  ) : (
                    <p>{busy || "Опишите задачу слева — Хасрой напишет сценарий, а здесь сразу появится живое превью со звуком. Или соберите ролик сами: «+ Сцена»."}</p>
                  )}
                </div>
                {variants.length && !focus ? (
                  <div className={styles.vars}>
                    <h3>Варианты</h3>
                    {variants.map((v, i) => {
                      const first = v.plan.scenes[0];
                      const [bg, fg] = first ? sceneColors(v.plan.theme, first.params.bg, first.tool) : BG.black;
                      return (
                        <button key={`${seeds[i]}-${looks[i]}-${theme}`} type="button" className={styles.v} data-fit data-on={chosen === i || undefined} style={{ background: bg, color: fg }} onClick={() => { setChosen(i); setOverrides({}); setView("preview"); }}>
                          <iframe title={`Вариант ${i + 1}`} tabIndex={-1} src={runtimeUrl(v.plan)} loading="lazy" />
                          <span><b>{lookName(looks[i])}</b>{soundLabel(v.plan)} · {v.plan.bpm}</span>
                        </button>
                      );
                    })}
                    <button type="button" className={styles.reroll} onClick={newVariants}><RefreshCw size={13} /> Новые</button>
                  </div>
                ) : null}
              </div>
              {plan && view === "preview" ? (
                <div className={styles.ctrl}>
                  <button type="button" onClick={() => seek(0)} title="В начало" aria-label="В начало"><SkipBack size={14} /></button>
                  <button type="button" onClick={() => selectScene(selected - 1)} title="Прошлая сцена (Shift+←)" aria-label="Прошлая сцена"><ChevronLeft size={15} /></button>
                  <button type="button" className={styles.playBtn} onClick={player.toggle} title="Пуск / пауза (пробел)">
                    {playing ? <Pause size={15} /> : <Play size={15} />}
                    <span>{fmt(time)} / {fmt(dur)}</span>
                  </button>
                  <button type="button" onClick={() => selectScene(selected + 1)} title="Следующая сцена (Shift+→)" aria-label="Следующая сцена"><ChevronRight size={15} /></button>
                  <button type="button" data-on={player.loop ? true : undefined} onClick={toggleLoop} title="Повтор сцены (L)" aria-label="Повтор сцены"><Repeat size={14} /></button>
                  <button type="button" data-on={player.muted ? true : undefined} onClick={() => player.setMuted(!player.muted)} title={player.muted ? "Включить звук" : "Выключить звук"} aria-label="Звук">{player.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                  <button type="button" data-on={safe || undefined} onClick={() => setSafe(!safe)} title="Зоны интерфейса Reels (G)" aria-label="Зоны Reels"><Smartphone size={14} /></button>
                  <button type="button" data-on={focus || undefined} onClick={() => setFocus(!focus)} title="Фокус (F)" aria-label="Фокус">{focus ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                </div>
              ) : null}
              {player.soundState === "making" ? <p className={styles.hint}>Собираю звук…</p> : null}
              {player.soundError ? <p className={styles.hintErr}>{player.soundError}</p> : null}
            </section>

            {/* ---------------- right: the selected scene, look, sound ---------------- */}
            <section className={`${styles.col} ${styles.side}`}>
              {sel && plan ? (
                <>
                  <div className={styles.sceneHead}>
                    <h3>Сцена {String(selected + 1).padStart(2, "0")}</h3>
                    <div className={styles.sceneBtns}>
                      <button type="button" onClick={() => moveScene(selected, selected - 1)} disabled={selected === 0 || selSource < 0} title="Раньше" aria-label="Раньше"><ChevronLeft size={14} /></button>
                      <button type="button" onClick={() => moveScene(selected, selected + 2)} disabled={selSource < 0 || selected >= sources.filter((s) => s >= 0).length - 1} title="Позже" aria-label="Позже"><ChevronRight size={14} /></button>
                      <button type="button" onClick={() => duplicateScene(selected)} disabled={selSource < 0} title="Дублировать (D)" aria-label="Дублировать"><Copy size={13} /></button>
                      <button type="button" onClick={() => deleteScene(selected)} disabled={selSource < 0} title="Удалить (Delete)" aria-label="Удалить"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {selScene ? (
                    <div className={styles.fields}>
                      <label className={styles.field}>Вид
                        <select value={selScene.kind || "надпись"} onChange={(e) => editScene(selSource, { kind: e.target.value })}>
                          {KIND_NAMES.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </label>
                      <label className={styles.field}>Надпись
                        <input value={selScene.text} onChange={(e) => editScene(selSource, { text: e.target.value })} placeholder="*слово* — акцент" />
                      </label>
                      {selScene.kind === "переписка" || selScene.kind === "голосовое" ? (
                        <label className={styles.field}>Реплики
                          <textarea rows={Math.max(2, selScene.lines?.length ?? 2)} value={linesToText(selScene.lines)} onChange={(e) => editScene(selSource, { lines: textToLines(e.target.value) })} placeholder={"Клиент: …\nИИнна: …"} />
                        </label>
                      ) : null}
                      {selScene.kind === "выбор" ? (
                        <label className={styles.field}>Вопрос владельцу
                          <input value={selScene.question ?? ""} onChange={(e) => editScene(selSource, { question: e.target.value })} />
                        </label>
                      ) : null}
                      {selScene.kind === "уведомление" ? (
                        <>
                          <label className={styles.field}>Заголовок пуша<input value={String(selScene.title ?? "")} onChange={(e) => editScene(selSource, { title: e.target.value })} placeholder="Пришёл новый заказ" /></label>
                          <label className={styles.field}>Строка под ним<input value={String(selScene.body ?? "")} onChange={(e) => editScene(selSource, { body: e.target.value })} /></label>
                        </>
                      ) : null}
                      {selScene.kind === "товар" ? (
                        <>
                          <label className={styles.field}>Товар<input value={String(selScene.name ?? "")} onChange={(e) => editScene(selSource, { name: e.target.value })} /></label>
                          <label className={styles.field}>Цена<input value={String(selScene.price ?? "")} onChange={(e) => editScene(selSource, { price: e.target.value })} placeholder="2 900 сом" /></label>
                        </>
                      ) : null}
                      {selScene.kind === "экран" ? (
                        <label className={styles.field}>Раздел кабинета<input value={String(selScene.section ?? "")} onChange={(e) => editScene(selSource, { section: e.target.value })} /></label>
                      ) : null}
                      {selScene.kind === "цифра" || selScene.kind === "часы" ? (
                        <label className={styles.field}>Цифра<input value={String(selScene.number ?? "")} onChange={(e) => editScene(selSource, { number: e.target.value })} placeholder="24/7" /></label>
                      ) : null}
                      {selScene.kind === "до/после" ? (
                        <label className={styles.field}>Без ИИнны (по строке)
                          <textarea rows={2} value={(selScene.before ?? []).join("\n")} onChange={(e) => editScene(selSource, { before: toList(e.target.value, 3) })} />
                        </label>
                      ) : null}
                      {["до/после", "завал", "смена слов", "список"].includes(selScene.kind || "") ? (
                        <label className={styles.field}>{selScene.kind === "до/после" ? "С ИИнной (по строке)" : selScene.kind === "смена слов" ? "Слова (по строке)" : selScene.kind === "завал" ? "Вопросы клиентов (по строке)" : "Пункты (по строке)"}
                          <textarea rows={3} value={(selScene.items ?? []).join("\n")} onChange={(e) => editScene(selSource, { items: toList(e.target.value, 5) })} />
                        </label>
                      ) : null}
                      {["ночь", "реакция", "печать", "цифра", "часы", "концовка", "фото"].includes(selScene.kind || "") ? (
                        <label className={styles.field}>Подпись<input value={String(selScene.label ?? "")} onChange={(e) => editScene(selSource, { label: e.target.value })} /></label>
                      ) : null}
                      {NEEDS_IMAGE.has(selScene.kind || "") ? (
                        <div className={styles.field}>{selScene.kind === "экран" ? "Скриншот" : "Фото"}
                          <div className={styles.imagePick}>
                            {selScene.image ? <img src={selScene.image} alt="" /> : <span>нет</span>}
                            <button type="button" onClick={() => setPicker({ kind: "scene", index: selSource })}><ImageIcon size={13} /> {selScene.image ? "Заменить" : "Выбрать"}</button>
                            {selScene.image ? <button type="button" onClick={() => editScene(selSource, { image: undefined })} aria-label="Убрать фото"><X size={13} /></button> : null}
                          </div>
                        </div>
                      ) : null}
                      {selScene.kind === "концовка" ? (
                        <div className={styles.field}>Логотип
                          <div className={styles.imagePick}>
                            {logo ? <img src={logo} alt="" /> : <span>нет</span>}
                            <button type="button" onClick={() => setPicker({ kind: "logo" })}><ImageIcon size={13} /> {logo ? "Заменить" : "Выбрать"}</button>
                            {logo ? <button type="button" onClick={() => setLogo("")} aria-label="Убрать логотип"><X size={13} /></button> : null}
                          </div>
                        </div>
                      ) : null}
                      <label className={styles.field}>Длина · {fmt(Number(selScene.seconds) || 0)} с{beat ? ` → ${Math.round(sel.duration / beat)} долей` : ""}
                        <input type="range" min={1} max={6} step={0.1} value={Number(selScene.seconds) || 2} onChange={(e) => editScene(selSource, { seconds: Number(e.target.value) })} />
                      </label>
                    </div>
                  ) : (
                    <p className={styles.muted}>Концовку Хасрой добавил сам. <button type="button" className={styles.linkBtn} onClick={() => script && setScenes([...script.scenes, { seconds: 2.6, kind: "концовка", text: "Ссылка в профиле", what: "" }])}>Сделать её редактируемой</button></p>
                  )}
                  {VARIANTS[sel.tool] ? (
                    <div className={styles.seg}>
                      {VARIANTS[sel.tool].map(([id, label]) => (
                        <button key={id} type="button" data-on={(sel.params.variant ?? VARIANTS[sel.tool][0][0]) === id || undefined} onClick={() => override({ variant: id })}>{label}</button>
                      ))}
                    </div>
                  ) : null}
                  <label className={styles.row}>Переход
                    <select value={sel.transition} disabled={selected === 0} onChange={(e) => override({ transition: e.target.value })}>
                      {Object.entries(TRANSITIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </label>
                  <label className={styles.row}>Камера
                    <select value={sel.camera ?? ""} onChange={(e) => override({ camera: e.target.value })}>
                      {Object.entries(CAMERAS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <p className={styles.muted}>Здесь настраивается выбранная сцена: текст, вид, фото, переход и камера.</p>
              )}

              <h3>Образ</h3>
              <div className={styles.themes}>
                {THEMES.map(([id, label]) => (
                  <button key={id || "auto"} type="button" disabled={!script} data-on={theme === id || undefined} onClick={() => setTheme(id)}>{label}</button>
                ))}
              </div>
              <button type="button" className={styles.smallBtn} disabled={!plan} onClick={shuffleMoves}><RefreshCw size={13} /> Другие переходы и камера</button>

              <h3>Звук</h3>
              <div className={styles.soundSeg}>
                {SOUND.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!script}
                    data-on={(sound || (plan?.music === "off" ? "off" : plan?.music === "track" ? "track" : plan?.style)) === s.id || undefined}
                    onClick={() => {
                      if (s.id === "track" && !track) setPicker({ kind: "track" });
                      else setSound(s.id);
                      setOverrides({});
                    }}
                  >{s.label}</button>
                ))}
              </div>
              {sound === "track" && track ? (
                <div className={styles.trackBox}>
                  <div className={styles.trackName}><Music size={13} /> <span>{track.name}</span><button type="button" onClick={() => setPicker({ kind: "track" })}>сменить</button></div>
                  <div className={styles.row}>Темп
                    <span className={styles.bpm}>
                      <button type="button" onClick={() => setTrack({ ...track, bpm: Math.max(70, Math.round(track.bpm / 2 >= 70 ? track.bpm / 2 : track.bpm - 1)) })} title="Вдвое медленнее">½</button>
                      <input type="number" min={70} max={170} value={track.bpm} onChange={(e) => setTrack({ ...track, bpm: Math.max(70, Math.min(170, Number(e.target.value) || 120)) })} aria-label="Темп" />
                      <button type="button" onClick={() => setTrack({ ...track, bpm: Math.min(170, track.bpm * 2 <= 170 ? track.bpm * 2 : track.bpm + 1) })} title="Вдвое быстрее">×2</button>
                    </span>
                  </div>
                  <label className={styles.field}>Начало трека · {fmt(track.offset)} с
                    <input type="range" min={0} max={120} step={0.5} value={track.offset} onChange={(e) => setTrack({ ...track, offset: Number(e.target.value) })} />
                  </label>
                </div>
              ) : null}
              <p className={styles.muted}>{sound === "track" ? "Склейки встают на доли вашего трека, эффекты звучат поверх." : "Музыка и эффекты собраны кодом под этот ролик."}</p>

              {plan ? (
                <>
                  <h3>Проверка</h3>
                  <div className={styles.row}>Ошибок <b data-ok={!current?.errors.length || undefined}>{current?.errors.length ? current.errors.length : "✓"}</b></div>
                  <div className={styles.row}>Фото на месте <b data-ok={!missingImages || undefined}>{missingImages ? `нет в ${missingImages}` : "✓"}</b></div>
                  <div className={styles.row}>Одинаковых переходов подряд <b data-ok={!repeats || undefined}>{repeats}</b></div>
                  <div className={styles.row}>Сохранено <b data-ok={saved || undefined}>{saved ? "✓" : "нет"}</b></div>
                  {current?.fixes.length ? (
                    <details className={styles.fixes}>
                      <summary>Проверка поправила {current.fixes.length}</summary>
                      <ul>{current.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
                    </details>
                  ) : null}
                  {current?.errors.length ? <ul className={styles.errors}>{current.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
                </>
              ) : null}

              {job?.status === "queued" ? <p className={styles.status}><span className={styles.pulse} />В очереди. GitHub забирает ролики каждые 5 минут, видео будет через 5–15 минут. Страницу можно закрыть.</p> : null}
              {job?.status === "rendering" ? <p className={styles.status}><span className={styles.pulse} />Собирается на GitHub, около 3 минут…</p> : null}
              {job?.status === "failed" ? <p className={styles.errorText}>{job.error || "Сборка не удалась."} Можно собрать заново.</p> : null}
              {job?.status === "done" && job.video_url ? (
                <a className={styles.download} href={job.video_url} download target="_blank" rel="noopener noreferrer"><Download size={14} /> Скачать MP4</a>
              ) : null}
            </section>
          </div>

          {/* ---------------- bottom: timeline ---------------- */}
          {plan ? (
            <section className={styles.timeline}>
              <div className={styles.tlHead}>
                <h3>Монтаж</h3>
                <span>тяните сцену — переставить · край сцены — длина · линейку — перемотать · ? — клавиши</span>
              </div>
              <div className={styles.track} ref={trackRef}>
                <div className={styles.ruler} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp} title="Тяните, чтобы перемотать">
                  {Array.from({ length: Math.floor(dur) + 1 }, (_, sec) => <b key={sec} style={{ left: `${(sec / (dur || 1)) * 100}%` }}>{sec}</b>)}
                  {beat ? Array.from({ length: Math.ceil(dur / beat) }, (_, i) => <i key={i} data-bar={i % 4 === 0 || undefined} style={{ left: `${((i * beat) / (dur || 1)) * 100}%` }} />) : null}
                  {player.loop ? <span className={styles.loopBand} style={{ left: `${(player.loop[0] / (dur || 1)) * 100}%`, width: `${((player.loop[1] - player.loop[0]) / (dur || 1)) * 100}%` }} /> : null}
                </div>
                <div className={styles.strip}>
                  {plan.scenes.map((s, i) => {
                    const [bg, fg] = sceneColors(plan.theme, s.params.bg, s.tool);
                    const src = sources[i];
                    const thumb = thumbPlan && thumbPlan.scenes.length === plan.scenes.length ? runtimeUrl(thumbPlan, starts[i] + s.duration * 0.6) : "";
                    return (
                      <div
                        key={i}
                        className={styles.cell}
                        data-on={selected === i || undefined}
                        data-fixed={src < 0 || undefined}
                        style={{ flex: s.duration, background: bg, color: fg }}
                        onPointerDown={(e) => onCellDown(e, i, "move")}
                        onPointerMove={onCellMove}
                        onPointerUp={(e) => onCellUp(e, i)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Сцена ${i + 1}: ${sceneLabel(s)}`}
                      >
                        <div className={styles.thumb} data-fit>{thumb ? <iframe title="" tabIndex={-1} src={thumb} loading="lazy" /> : null}</div>
                        <div className={styles.cellText}>
                          <b>{sceneLabel(s)}</b>
                          <span>{TOOL_KIND[s.tool] ?? s.tool} · {fmt(s.duration)} с</span>
                        </div>
                        {i > 0 ? <em title="Переход">{TRANSITIONS[s.transition] ?? s.transition}</em> : null}
                        {src >= 0 ? (
                          <span
                            className={styles.handle}
                            title="Тяните — длина сцены"
                            onPointerDown={(e) => onCellDown(e, i, "size")}
                            onPointerMove={onCellMove}
                            onPointerUp={(e) => onCellUp(e, i)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                  {dropAt !== null ? <div className={styles.drop} style={{ left: `${((dropAt < starts.length ? starts[dropAt] : dur) / (dur || 1)) * 100}%` }} /> : null}
                </div>
                <div className={styles.waveLane} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp}>
                  {(player.wave.length ? player.wave : Array.from({ length: 96 }, () => 0.03)).map((h, i, arr) => (
                    <i key={i} style={{ height: `${Math.max(6, h * 100)}%`, opacity: dur && i / arr.length <= time / dur ? 1 : 0.4 }} />
                  ))}
                  <span className={styles.laneLabel}><Music size={11} /> {soundLabel(plan)}{plan.bpm ? ` · ${plan.bpm} BPM` : ""}</span>
                </div>
                <div className={styles.head} style={{ left: `${(time / (dur || 1)) * 100}%` }} />
              </div>
            </section>
          ) : null}
        </>
      )}

      {/* ---------------- media library ---------------- */}
      {picker ? (
        <div className={styles.modalBack} onClick={() => setPicker(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Медиатека">
            <div className={styles.modalHead}>
              <h3>{picker.kind === "track" ? "Музыка" : picker.kind === "logo" ? "Логотип" : "Медиатека"}</h3>
              <button type="button" onClick={() => setPicker(null)} aria-label="Закрыть"><X size={16} /></button>
            </div>
            <button type="button" className={styles.uploadBtn} onClick={() => fileInput.current?.click()} disabled={!!uploading}>
              <Upload size={15} /> {uploading || (picker.kind === "track" ? "Загрузить трек (mp3, m4a, wav)" : "Загрузить фото или скриншот (jpg, png, webp)")}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept={picker.kind === "track" ? "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg" : "image/png,image/jpeg,image/webp"}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}
            />
            <div className={styles.assetGrid}>
              {shownAssets.map((a) => (
                <button
                  key={a.url}
                  type="button"
                  className={styles.asset}
                  data-audio={a.kind === "audio" || undefined}
                  disabled={picker.kind === "scene" && picker.index < 0}
                  onClick={() => void applyPick(a)}
                >
                  {a.kind === "image" ? <img src={a.url} alt="" loading="lazy" /> : <span><Music size={20} /></span>}
                  <small>{a.kind === "audio" ? "трек" : "фото"} · {new Date(a.created_at).toLocaleDateString("ru-RU")}</small>
                </button>
              ))}
            </div>
            {!shownAssets.length ? (
              <p className={styles.muted}>{demo ? "В демо загрузка недоступна." : "Пока пусто. Загруженные файлы остаются здесь для следующих роликов."}</p>
            ) : null}
            {picker.kind === "scene" && picker.index < 0 ? <p className={styles.muted}>Чтобы вставить картинку, выберите сцену «фото», «товар» или «экран».</p> : null}
          </div>
        </div>
      ) : null}

      {showKeys ? (
        <div className={styles.modalBack} onClick={() => setShowKeys(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Клавиши">
            <div className={styles.modalHead}><h3>Клавиши</h3><button type="button" onClick={() => setShowKeys(false)} aria-label="Закрыть"><X size={16} /></button></div>
            <dl className={styles.keys}>{KEYS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
      ) : null}

      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </main>
  );
}
