"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Clapperboard, Download, Pause, Play, Plus, RefreshCw, SkipBack, Sparkles, Trash2, Volume2, VolumeX } from "lucide-react";
import { waitLabel } from "@/lib/ai/limits";
import { KINDS, LOOKS, scriptToPlan, type Script as ComposeScript } from "@/lib/reels/compose";
import { soundtrack, type Cue } from "@/lib/reels/preview-audio";
import styles from "./reels.module.css";

type Line = { from: "client" | "inna"; text: string };
type Scene = { seconds: number; kind?: string; what: string; text: string; lines?: Line[]; question?: string; [key: string]: unknown };
type Script = { title: string; idea: string; scenes: Scene[] };
type PlanScene = { tool: string; duration: number; transition: string; camera?: string; params: Record<string, unknown> };
type Plan = { title: string; scenes: PlanScene[]; style?: string; bpm?: number; seed?: number; music?: "on" | "off"; theme?: string };
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
type ReelWindow = Window & { reel?: { load(plan: Plan): number; seek(t: number): void; cues(): Cue[]; scenes: { tool: string; cut: number }[] } };

const KIND_NAMES = Object.keys(KINDS);
const TOOL_KIND: Record<string, string> = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.tool, k]));
const STATUS: Record<Job["status"], string> = { draft: "черновик", queued: "в очереди", rendering: "собирается", done: "готово", failed: "ошибка" };
const SOUND = [
  { id: "pulse", label: "Пульс" },
  { id: "bounce", label: "Бит" },
  { id: "chill", label: "Спокойно" },
  { id: "off", label: "Без" },
];
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
};
const BG: Record<string, [string, string]> = { cream: ["#ebe6dc", "#111"], black: ["#0b0b0d", "#fff"], violet: ["#8853fd", "#fff"] };
const CHIPS = ["смелее", "короче", "больше переписки", "резче крючок"];
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

const EXAMPLES = [
  "Рилс: ИИнна понимает голосовые — клиент наговорил заказ, она ответила и оформила",
  "Рилс про то, что владелец больше не сидит в директе 24/7",
  "Рилс: клиент просит скидку, ИИнна спрашивает владельца кнопками Да/Нет",
];

const linesToText = (lines?: Line[]) => (lines ?? []).map((l) => `${l.from === "client" ? "Клиент" : "ИИнна"}: ${l.text}`).join("\n");
const textToLines = (value: string): Line[] =>
  value.split("\n").map((r) => r.trim()).filter(Boolean).map((row) => {
    const m = /^(клиент|client|иинна|inna|я)\s*:\s*(.*)$/iu.exec(row);
    return m ? { from: /^(клиент|client)$/iu.test(m[1]) ? ("client" as const) : ("inna" as const), text: m[2] } : { from: "client" as const, text: row };
  });
const newSeed = () => Math.floor(Math.random() * 1_000_000);
const LOOK_BY_THEME: Record<string, string> = Object.fromEntries(LOOKS.map((l) => [l.theme, l.id]));
const lookName = (id: string) => LOOKS.find((l) => l.id === id)?.name ?? id;
/** Three different looks, avoiding the ones on screen now when possible; `first` stays in front. */
function pickLooks(avoid: string[] = [], first?: string): string[] {
  const ids = LOOKS.map((l) => l.id).sort(() => Math.random() - 0.5);
  const fresh = ids.filter((id) => !avoid.includes(id) && id !== first);
  const rest = ids.filter((id) => avoid.includes(id) && id !== first);
  return [...(first ? [first] : []), ...fresh, ...rest].slice(0, 3);
}
// Scene colours on the storyboard, per theme (same as public/reels-runtime/styles.css).
const THEME_BG: Record<string, Record<string, [string, string]>> = {
  night: { cream: ["#15121f", "#fff"], violet: ["#2a1b5c", "#fff"] },
  mono: { violet: ["#0b0b0d", "#fff"], black: ["#ece8df", "#111"] },
  acid: { cream: ["#f6f4ee", "#111"], violet: ["#c6ff3d", "#111"] },
};
const sceneColors = (theme: string | undefined, bg: unknown, tool: string): [string, string] => {
  if (tool === "night") return ["#2a1f55", "#fff"];
  const key = String(bg || "black");
  return THEME_BG[theme ?? ""]?.[key] ?? BG[key] ?? BG.black;
};
const fmt = (s: number) => s.toFixed(1).replace(".", ",");
const plain = (v: unknown) => (typeof v === "string" ? v.replace(/\*/g, "").replace(/\n/g, " ") : "");
const sceneLabel = (s: PlanScene) =>
  plain(s.params.text) || plain(s.params.headline) || plain(s.params.title) || plain(s.params.word) || plain(s.params.line) || plain(s.params.name) || plain(s.params.number) || TOOL_KIND[s.tool] || s.tool;

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

export default function ReelsStudio() {
  const [brief, setBrief] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [list, setList] = useState<ListItem[]>([]);
  const [waiting, setWaiting] = useState<{ until: number; pending: Pending } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<"studio" | "done" | "queue">("studio");
  // Variants: three seeds over the same script; the chosen one is what gets rendered.
  const [seeds, setSeeds] = useState<number[]>(() => [newSeed(), newSeed(), newSeed()]);
  const [looks, setLooks] = useState<string[]>(() => pickLooks());
  const [chosen, setChosen] = useState(0);
  const [sound, setSound] = useState<string>("");
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"preview" | "video">("preview");

  const refreshList = useCallback(() => {
    api<{ jobs: ListItem[] }>(null).then((d) => setList(d.jobs)).catch((e: { unauthorized?: boolean }) => { if (e.unauthorized) setUnauthorized(true); });
  }, []);

  const openJob = useCallback((next: Job | null, keepLook = false) => {
    setJob(next);
    if (!next) return;
    setBrief(next.brief || "");
    setScript(next.script);
    if (!keepLook) {
      setSeeds([next.plan?.seed ?? newSeed(), newSeed(), newSeed()]);
      setLooks(pickLooks([], next.plan?.theme ? LOOK_BY_THEME[next.plan.theme] : undefined));
      setChosen(0);
      setSound(next.plan ? (next.plan.music === "off" ? "off" : next.plan.style || "") : "");
      setOverrides({});
      setView(next.status === "done" && next.video_url ? "video" : "preview");
    }
    const url = new URL(window.location.href);
    url.searchParams.set("job", next.id);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    // ?demo — the studio with a sample script and no server calls: for checking the editor itself.
    if (params.has("demo")) {
      setBrief(DEMO.idea);
      setScript(DEMO);
      return;
    }
    refreshList();
    const id = params.get("job");
    if (id) api<{ job: Job | null }>(null, `?id=${id}`).then((d) => openJob(d.job)).catch(() => undefined);
    const fromChat = params.get("brief");
    if (!id && fromChat) setBrief(fromChat.slice(0, 2000));
  }, [refreshList, openJob]);

  // Follow a reel while GitHub renders it.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "rendering")) return;
    const timer = setInterval(() => {
      api<{ job: Job | null }>(null, `?id=${job.id}`)
        .then((d) => {
          if (d.job && d.job.status !== job.status) {
            setJob(d.job);
            if (d.job.status === "done") setView("video");
            refreshList();
          }
        })
        .catch(() => undefined);
    }, 20_000);
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
      if (e.unauthorized) setUnauthorized(true);
      if (e.retryAt) setWaiting({ until: e.retryAt, pending: { label, run: () => step(label, run) } });
      else setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const writeScript = (note?: string) =>
    step(note ? "Хасрой переписывает сценарий…" : "Хасрой пишет сценарий…", async () => {
      const d = await api<{ job: Job }>({
        action: "script",
        id: job && job.status !== "queued" && job.status !== "rendering" ? job.id : undefined,
        brief,
        previous: note ? script : undefined,
        feedback: note || undefined,
      });
      openJob(d.job);
      setSeeds([newSeed(), newSeed(), newSeed()]);
      setLooks((old) => pickLooks(old));
      setChosen(0);
      setOverrides({});
      setFeedback("");
      setView("preview");
      refreshList();
    });

  // ---------- variants, built right here in the browser ----------
  const variants = useMemo(() => {
    if (!script?.scenes.length) return [];
    const style = sound && sound !== "off" ? sound : undefined;
    return seeds.map((seed, i) => {
      const checked = scriptToPlan(script as unknown as ComposeScript, seed, { style, look: looks[i] });
      const plan = checked.plan as unknown as Plan;
      if (sound === "off") plan.music = "off";
      return { plan, fixes: checked.fixes, errors: checked.errors };
    });
  }, [script, seeds, sound, looks]);

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
          transition: o.transition ?? s.transition,
          camera: o.camera === undefined ? s.camera : o.camera || undefined,
          params: o.variant ? { ...s.params, variant: o.variant } : s.params,
        };
      }),
    };
  }, [current, overrides, job]);
  const planJson = plan ? JSON.stringify(plan) : "";
  const saved = Boolean(job?.plan && planJson === JSON.stringify(job.plan));
  const total = plan ? plan.scenes.reduce((n, s) => n + s.duration, 0) : 0;
  const beat = plan?.bpm ? 60 / plan.bpm : 0;
  const repeats = plan ? plan.scenes.filter((s, i) => i > 1 && s.transition === plan.scenes[i - 1].transition).length : 0;
  const sel = plan?.scenes[Math.min(selected, (plan?.scenes.length ?? 1) - 1)];

  // ---------- player: the studio drives the runtime and the sound from one clock ----------
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameLoads, setFrameLoads] = useState(0);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [wave, setWave] = useState<number[]>([]);
  const audio = useRef<{ ctx?: AudioContext; buffer?: AudioBuffer; source?: AudioBufferSourceNode; samples?: Float32Array; rate?: number }>({});
  const clock = useRef({ startedAt: 0, offset: 0 });
  const [outroAt, setOutroAt] = useState<number | undefined>();

  const reelWin = () => frame.current?.contentWindow as ReelWindow | null | undefined;

  const stopSound = () => {
    try { audio.current.source?.stop(); } catch { /* already stopped */ }
    audio.current.source = undefined;
  };
  const startSound = (offset: number) => {
    stopSound();
    const a = audio.current;
    if (muted || !a.samples || !a.rate) return;
    if (!a.ctx) a.ctx = new AudioContext();
    if (!a.buffer || a.buffer.sampleRate !== a.rate) {
      a.buffer = a.ctx.createBuffer(1, a.samples.length, a.rate);
      a.buffer.getChannelData(0).set(a.samples);
    }
    void a.ctx.resume();
    const src = a.ctx.createBufferSource();
    src.buffer = a.buffer;
    src.connect(a.ctx.destination);
    src.start(0, Math.min(offset, a.buffer.duration - 0.01));
    a.source = src;
  };

  // Load the plan into the runtime; work out the soundtrack from its cues.
  useEffect(() => {
    const win = reelWin();
    if (!frameLoads || !win?.reel || !plan) return;
    let cancelled = false;
    const doc = win.document;
    Promise.all([...doc.fonts].map((f) => f.load().catch(() => undefined))).then(() => {
      if (cancelled || !win.reel) return;
      const d = win.reel.load(plan);
      setDuration(d);
      win.reel.seek(Math.min(clock.current.offset, d - 0.01));
      const cues = win.reel.cues();
      const outro = win.reel.scenes.find((s) => s.tool === "outro")?.cut;
      setOutroAt(outro);
      setTimeout(() => {
        if (cancelled) return;
        const { samples, sampleRate } = soundtrack(d, cues, { style: plan.style, bpm: plan.bpm, seed: plan.seed, outroAt: outro, music: plan.music !== "off" });
        audio.current.samples = samples;
        audio.current.rate = sampleRate;
        audio.current.buffer = undefined;
        const bars = 72;
        const step = Math.floor(samples.length / bars);
        setWave(Array.from({ length: bars }, (_, i) => {
          let peak = 0;
          for (let k = i * step; k < (i + 1) * step; k += 16) peak = Math.max(peak, Math.abs(samples[k]));
          return peak;
        }));
        if (playing) {
          clock.current = { startedAt: performance.now(), offset: clock.current.offset };
          startSound(clock.current.offset);
        }
      }, 30);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameLoads, planJson]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      let t = clock.current.offset + (performance.now() - clock.current.startedAt) / 1000;
      if (duration && t >= duration) {
        clock.current = { startedAt: performance.now(), offset: 0 };
        t = 0;
        startSound(0);
      }
      reelWin()?.reel?.seek(t);
      setTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  const play = () => {
    clock.current = { startedAt: performance.now(), offset: time >= duration - 0.05 ? 0 : time };
    startSound(clock.current.offset);
    setPlaying(true);
  };
  const pause = () => {
    clock.current.offset = time;
    stopSound();
    setPlaying(false);
  };
  const seek = (t: number) => {
    const v = Math.max(0, Math.min(t, Math.max(0, duration - 0.01)));
    clock.current = { startedAt: performance.now(), offset: v };
    setTime(v);
    reelWin()?.reel?.seek(v);
    if (playing) startSound(v);
  };
  useEffect(() => {
    if (muted) stopSound();
    else if (playing) startSound(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);
  useEffect(() => () => stopSound(), []);

  // Selecting a scene on the storyboard jumps to it.
  const sceneStart = (i: number) => (plan ? plan.scenes.slice(0, i).reduce((n, s) => n + s.duration, 0) : 0);
  const selectScene = (i: number) => {
    setSelected(i);
    seek(sceneStart(i) + 0.4);
  };
  useEffect(() => {
    if (!plan) return;
    let acc = 0;
    for (let i = 0; i < plan.scenes.length; i++) {
      acc += plan.scenes[i].duration;
      if (time < acc) { if (i !== selected) setSelected(i); break; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  // The preview and the variant thumbnails scale the 1080×1920 runtime to whatever size they get.
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-fit]");
    const ro = new ResizeObserver((entries) => entries.forEach((e) => {
      const n = e.target as HTMLElement;
      n.style.setProperty("--s", String(n.clientWidth / 1080));
    }));
    nodes.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  });

  // Editing keys: space plays, arrows step by a beat, Shift+arrows jump between scenes.
  const keys = useRef({ play: () => {}, pause: () => {}, seek: (_t: number) => {}, select: (_i: number) => {}, time: 0, playing: false, beat: 0, starts: [] as number[] });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const k = keys.current;
      if (e.code === "Space") {
        e.preventDefault();
        if (k.playing) k.pause(); else k.play();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey && k.starts.length) {
          let cur = 0;
          k.starts.forEach((s0, i) => { if (s0 <= k.time + 0.01) cur = i; });
          const next = Math.max(0, Math.min(k.starts.length - 1, cur + dir));
          k.select(next);
        } else k.seek(k.time + dir * (k.beat || 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const scrubFrom = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * (duration || total));
  };

  // ---------- actions ----------
  const editScene = (i: number, patch: Partial<Scene>) => {
    if (!script) return;
    setScript({ ...script, scenes: script.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  };
  const changeScenes = (scenes: Scene[]) => {
    if (!script) return;
    setScript({ ...script, scenes });
    setOverrides({});
  };
  const override = (patch: Override) => setOverrides((o) => ({ ...o, [selected]: { ...o[selected], ...patch } }));
  const newVariants = () => {
    setSeeds([newSeed(), newSeed(), newSeed()]);
    setLooks((old) => pickLooks(old));
    setChosen(0);
    setOverrides({});
  };

  const render = () =>
    step("Сохраняю и ставлю в очередь…", async () => {
      if (!plan || !script) return;
      const d = await api<{ job: Job }>({ action: "plan", id: job && job.status !== "queued" && job.status !== "rendering" ? job.id : undefined, brief, script, plan });
      const q = await api<{ job: Job }>({ action: "render", id: d.job.id });
      openJob(q.job, true);
      refreshList();
    });

  const reset = () => {
    pause();
    setJob(null);
    setScript(null);
    setBrief("");
    setOverrides({});
    setTab("studio");
    window.history.replaceState(null, "", "/owner/reels");
  };

  keys.current = {
    play, pause, seek, select: selectScene, time, playing, beat,
    starts: plan ? plan.scenes.map((_, i) => sceneStart(i)) : [],
  };

  const done = list.filter((r) => r.status === "done");
  const queue = list.filter((r) => r.status === "queued" || r.status === "rendering");
  const rendering = job?.status === "queued" || job?.status === "rendering";
  const pill = busy || (waiting ? `Жду лимит · ${waitLabel(waiting.until - now)}` : rendering ? (job?.status === "queued" ? "В очереди на сборку" : "Видео собирается") : "Хасрой готов");

  const main = { display: "flex", flexDirection: "column", maxWidth: "none", padding: 0, height: "100dvh" } as const;

  if (unauthorized) {
    return (
      <main className={styles.page} style={main}>
        <div className={styles.gate}>
          <p>Рилсы доступны только владельцу.</p>
          <a className={styles.cta} href="/owner">Войти в консоли</a>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} style={main}>
      <header className={styles.top}>
        <a href="/owner" className={styles.back} aria-label="Консоль"><ArrowLeft size={16} /></a>
        <div className={styles.logo}>ХАСРОЙ <b>·</b> студия</div>
        <nav className={styles.tabs}>
          <button type="button" data-on={tab === "studio" || undefined} onClick={() => setTab("studio")}>{job ? "Ролик" : "Новый ролик"}</button>
          <button type="button" data-on={tab === "done" || undefined} onClick={() => setTab("done")}>Готовые · {done.length}</button>
          <button type="button" data-on={tab === "queue" || undefined} onClick={() => setTab("queue")}>Очередь · {queue.length}</button>
        </nav>
        <div className={styles.right}>
          <span className={styles.pill} data-busy={Boolean(busy || waiting || rendering) || undefined}><i />{pill}</span>
          {job ? <button type="button" className={styles.pillBtn} onClick={reset}><Plus size={14} /> Новый</button> : null}
          <button type="button" className={styles.cta} disabled={!plan || !script || !!busy || rendering || !!current?.errors.length} onClick={render}>
            <Clapperboard size={16} /> {job?.status === "done" && saved ? "Собрать заново" : "Собрать видео"}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
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
            {/* ---------- left: brief and script ---------- */}
            <section className={styles.col}>
              <h3>Задача</h3>
              <textarea className={styles.brief} value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="О чём ролик? Например: ИИнна понимает голосовые" />
              {!brief && !script ? (
                <div className={styles.examples}>{EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setBrief(x)}>{x}</button>)}</div>
              ) : null}
              <button type="button" className={styles.write} disabled={!brief.trim() || !!busy || rendering} onClick={() => writeScript()}>
                <Sparkles size={15} /> {script ? "Написать заново" : "Написать сценарий"}
              </button>
              {script ? (
                <>
                  <div className={styles.chips}>
                    {CHIPS.map((c) => <button key={c} type="button" disabled={!!busy || rendering} onClick={() => writeScript(c)}>{c}</button>)}
                  </div>
                  <form className={styles.feedback} onSubmit={(e) => { e.preventDefault(); if (feedback.trim()) void writeScript(feedback.trim()); }}>
                    <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Своя правка…" aria-label="Правка к сценарию" />
                    <button type="submit" disabled={!feedback.trim() || !!busy || rendering} aria-label="Переписать"><RefreshCw size={14} /></button>
                  </form>
                  <h3>Сценарий · {script.scenes.length} сцен · {fmt(total)} с</h3>
                  <input className={styles.title} value={script.title} onChange={(e) => setScript({ ...script, title: e.target.value })} aria-label="Название ролика" />
                  <ol className={styles.scenes}>
                    {script.scenes.map((s, i) => (
                      <li key={i} data-on={editing === i || undefined}>
                        <button type="button" className={styles.sceneRow} onClick={() => setEditing(editing === i ? null : i)}>
                          <i>{String(i + 1).padStart(2, "0")}</i>
                          <span>{plain(s.text) || "—"}<small>{s.kind || "надпись"}</small></span>
                          <em>{fmt(Number(s.seconds) || 0)}</em>
                        </button>
                        {editing === i ? (
                          <div className={styles.sceneEdit}>
                            <div className={styles.sceneLine}>
                              <select value={s.kind || "надпись"} onChange={(e) => editScene(i, { kind: e.target.value })} aria-label="Вид сцены">
                                {KIND_NAMES.map((k) => <option key={k} value={k}>{k}</option>)}
                              </select>
                              <input type="number" min={1} max={6} step={0.5} value={s.seconds} onChange={(e) => editScene(i, { seconds: Number(e.target.value) })} aria-label="Секунды" />
                              <button type="button" aria-label="Убрать сцену" onClick={() => { changeScenes(script.scenes.filter((_, k) => k !== i)); setEditing(null); }}><Trash2 size={14} /></button>
                            </div>
                            <input value={s.text} onChange={(e) => editScene(i, { text: e.target.value })} placeholder="Надпись на экране (*слово* — акцент)" aria-label="Надпись" />
                            {s.kind === "переписка" || s.kind === "голосовое" ? (
                              <textarea rows={Math.max(2, s.lines?.length ?? 2)} value={linesToText(s.lines)} onChange={(e) => editScene(i, { lines: textToLines(e.target.value) })} placeholder={"Клиент: …\nИИнна: …"} aria-label="Реплики" />
                            ) : null}
                            {s.kind === "выбор" ? <input value={s.question ?? ""} onChange={(e) => editScene(i, { question: e.target.value })} placeholder="Вопрос владельцу" aria-label="Вопрос" /> : null}
                            {s.kind === "до/после" ? (
                              <textarea rows={2} value={((s.before as string[] | undefined) ?? []).join("\n")} onChange={(e) => editScene(i, { before: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 3) })} placeholder={"Без ИИнны — по строке:\nОтвет через час"} aria-label="До" />
                            ) : null}
                            {["до/после", "завал", "смена слов", "список"].includes(s.kind || "") ? (
                              <textarea rows={3} value={((s.items as string[] | undefined) ?? []).join("\n")} onChange={(e) => editScene(i, { items: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 5) })} placeholder={s.kind === "до/после" ? "С ИИнной — по строке" : s.kind === "смена слов" ? "Слова по строке: отвечает…" : s.kind === "завал" ? "Вопросы клиентов по строке" : "Пункты по строке"} aria-label="Пункты" />
                            ) : null}
                            {["ночь", "реакция", "печать", "цифра", "концовка"].includes(s.kind || "") ? <input value={String(s.label ?? "")} onChange={(e) => editScene(i, { label: e.target.value })} placeholder="Подпись" aria-label="Подпись" /> : null}
                            {s.kind === "уведомление" ? <input value={String(s.title ?? "")} onChange={(e) => editScene(i, { title: e.target.value })} placeholder="Заголовок пуша" aria-label="Заголовок пуша" /> : null}
                            {s.kind === "товар" ? <input value={String(s.name ?? "")} onChange={(e) => editScene(i, { name: e.target.value })} placeholder="Название товара" aria-label="Товар" /> : null}
                            <textarea rows={1} value={s.what} onChange={(e) => editScene(i, { what: e.target.value })} placeholder="Что в кадре" aria-label="Что в кадре" />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <button type="button" className={styles.addScene} onClick={() => { changeScenes([...script.scenes, { seconds: 2.5, kind: "надпись", what: "", text: "" }]); setEditing(script.scenes.length); }}>
                    <Plus size={14} /> Сцена
                  </button>
                </>
              ) : null}
            </section>

            {/* ---------- center: preview and variants ---------- */}
            <section className={styles.stage}>
              {job?.video_url ? (
                <div className={styles.viewSwitch}>
                  <button type="button" data-on={view === "preview" || undefined} onClick={() => setView("preview")}>Превью</button>
                  <button type="button" data-on={view === "video" || undefined} onClick={() => { pause(); setView("video"); }}>Готовое видео</button>
                </div>
              ) : null}
              <div className={styles.stageRow}>
                <div className={styles.phone} data-fit>
                  {view === "video" && job?.video_url ? (
                    <video src={job.video_url} controls playsInline autoPlay />
                  ) : plan ? (
                    <iframe ref={frame} title="Превью рилса" src="/reels-runtime/index.html" onLoad={() => setFrameLoads((n) => n + 1)} />
                  ) : (
                    <p>{busy || "Опишите задачу слева — Хасрой напишет сценарий, а здесь сразу появится живое превью со звуком."}</p>
                  )}
                </div>
                {variants.length ? (
                  <div className={styles.vars}>
                    <h3>Варианты</h3>
                    {variants.map((v, i) => {
                      const first = v.plan.scenes[0];
                      const [bg, fg] = first ? sceneColors(v.plan.theme, first.params.bg, first.tool) : BG.black;
                      return (
                        <button key={`${seeds[i]}-${looks[i]}`} type="button" className={styles.v} data-fit data-on={chosen === i || undefined} style={{ background: bg, color: fg }} onClick={() => { setChosen(i); setOverrides({}); setView("preview"); }}>
                          <iframe title={`Вариант ${i + 1}`} tabIndex={-1} src={`/reels-runtime/index.html#${encodeURIComponent(JSON.stringify(v.plan))}`} loading="lazy" />
                          <span><b>{lookName(looks[i])}</b>{SOUND.find((s) => s.id === (v.plan.music === "off" ? "off" : v.plan.style))?.label ?? v.plan.style} · {v.plan.bpm}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {plan && view === "preview" ? (
                <div className={styles.ctrl}>
                  <button type="button" onClick={() => seek(0)} aria-label="В начало"><SkipBack size={14} /></button>
                  <button type="button" className={styles.playBtn} onClick={playing ? pause : play}>{playing ? <Pause size={14} /> : <Play size={14} />} {fmt(time)} / {fmt(duration || total)}</button>
                  <button type="button" onClick={() => setMuted(!muted)} aria-label={muted ? "Включить звук" : "Выключить звук"}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                  <button type="button" onClick={newVariants} disabled={!variants.length}><RefreshCw size={14} /> Новые варианты</button>
                </div>
              ) : null}
            </section>

            {/* ---------- right: sound, scene, checks ---------- */}
            <section className={`${styles.col} ${styles.side}`}>
              <h3>Звук</h3>
              <div className={styles.seg}>
                {SOUND.map((s) => (
                  <button key={s.id} type="button" disabled={!script} data-on={(sound || (plan?.music === "off" ? "off" : plan?.style)) === s.id || undefined} onClick={() => { setSound(s.id); setOverrides({}); }}>{s.label}</button>
                ))}
              </div>
              <div className={styles.wave} aria-hidden>
                {(wave.length ? wave : Array.from({ length: 72 }, () => 0.04)).map((h, i) => (
                  <i key={i} style={{ height: `${Math.max(4, h * 100)}%`, opacity: duration && i / 72 <= time / duration ? 1 : 0.45 }} />
                ))}
              </div>
              <p className={styles.muted}>Музыка и звуки собраны кодом под этот ролик{plan?.bpm ? ` · ${plan.bpm} ударов в минуту` : ""}.</p>

              {sel && plan ? (
                <>
                  <h3>Сцена {String(selected + 1).padStart(2, "0")} · {TOOL_KIND[sel.tool] ?? sel.tool}</h3>
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
                  <div className={styles.row}>Длина <b>{beat ? `${Math.round(sel.duration / beat)} долей · ` : ""}{fmt(sel.duration)} с</b></div>
                </>
              ) : null}

              {plan ? (
                <>
                  <h3>Проверка</h3>
                  <div className={styles.row}>Ошибок <b data-ok={!current?.errors.length || undefined}>{current?.errors.length ? current.errors.length : "✓"}</b></div>
                  <div className={styles.row}>Переходов подряд одинаковых <b data-ok={!repeats || undefined}>{repeats}</b></div>
                  <div className={styles.row}>Сохранено для сборки <b data-ok={saved || undefined}>{saved ? "✓" : "нет"}</b></div>
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
              {job?.status === "failed" ? <p className={styles.error}>{job.error || "Сборка не удалась."} Можно собрать заново.</p> : null}
              {job?.status === "done" && job.video_url ? (
                <a className={styles.download} href={job.video_url} download target="_blank" rel="noopener noreferrer"><Download size={14} /> Скачать MP4</a>
              ) : null}
            </section>
          </div>

          {/* ---------- bottom: storyboard on the beat grid ---------- */}
          {plan ? (
            <section className={styles.timeline}>
              <h3>Раскадровка · склейки в такт <span>пробел — пуск · ← → — по долям · Shift + ← → — по сценам · тяните линейку</span></h3>
              <div className={styles.track} onWheel={(e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) seek(time + (e.deltaX || e.deltaY) * 0.004); }}>
                <div className={styles.strip}>
                  {plan.scenes.map((s, i) => {
                    const [bg, fg] = sceneColors(plan.theme, s.params.bg, s.tool);
                    return (
                      <button key={i} type="button" className={styles.cell} data-on={selected === i || undefined} style={{ flex: s.duration, background: bg, color: fg }} onClick={() => selectScene(i)}>
                        <b>{sceneLabel(s)}</b>
                        <span>{TOOL_KIND[s.tool] ?? s.tool} · {fmt(s.duration)} с</span>
                        {i > 0 ? <em title={TRANSITIONS[s.transition]}>{TRANSITIONS[s.transition] ?? s.transition}</em> : null}
                      </button>
                    );
                  })}
                </div>
                <div
                  className={styles.beats}
                  title="Тяните, чтобы перемотать"
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e); }}
                  onPointerMove={(e) => { if (e.buttons & 1) scrubFrom(e); }}
                >
                  {Array.from({ length: Math.floor(total) + 1 }, (_, sec) => <b key={`s${sec}`} style={{ left: `${(sec / (total || 1)) * 100}%` }}>{sec}</b>)}
                  {beat ? Array.from({ length: Math.ceil(total / beat) }, (_, i) => <i key={i} data-bar={i % 4 === 0 || undefined} style={{ left: `${((i * beat) / total) * 100}%` }} />) : null}
                  {outroAt ? <i className={styles.drop} style={{ left: `${(outroAt / total) * 100}%` }} /> : null}
                </div>
                <div className={styles.head} style={{ left: `${(time / (duration || total || 1)) * 100}%` }} />
              </div>
              <p className={styles.lane}>♪ <b>{SOUND.find((s) => s.id === (plan.music === "off" ? "off" : plan.style))?.label}</b>{plan.bpm ? ` · ${plan.bpm} BPM` : ""} · эффекты на переходах, ударах, сообщениях и уведомлениях</p>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
