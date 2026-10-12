"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Clapperboard, Download, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { waitLabel } from "@/lib/ai/limits";
import styles from "./reels.module.css";

type Scene = { seconds: number; what: string; text: string };
type Script = { title: string; idea: string; scenes: Scene[] };
type PlanScene = { tool: string; duration: number; transition: string; params: Record<string, unknown> };
type Plan = { title: string; scenes: PlanScene[] };
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

const STATUS: Record<Job["status"], string> = {
  draft: "черновик",
  queued: "в очереди",
  rendering: "собирается",
  done: "готово",
  failed: "ошибка",
};

const EXAMPLES = [
  "Рилс: ИИнна понимает голосовые — клиент наговорил заказ, она ответила и оформила",
  "Рилс про то, что владелец больше не сидит в директе 24/7",
  "Рилс: клиент просит скидку, ИИнна спрашивает владельца кнопками Да/Нет",
];

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
  const [fixes, setFixes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [list, setList] = useState<ListItem[]>([]);
  const [waiting, setWaiting] = useState<{ until: number; pending: Pending } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The script was edited after the preview was built.
  const [dirty, setDirty] = useState(false);

  const refreshList = useCallback(() => {
    api<{ jobs: ListItem[] }>(null).then((d) => setList(d.jobs)).catch((e: { unauthorized?: boolean }) => { if (e.unauthorized) setUnauthorized(true); });
  }, []);

  const openJob = useCallback((next: Job | null) => {
    setJob(next);
    if (next) {
      setBrief(next.brief || "");
      setScript(next.script);
      setDirty(false);
      const url = new URL(window.location.href);
      url.searchParams.set("job", next.id);
      window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    refreshList();
    const id = new URL(window.location.href).searchParams.get("job");
    if (id) api<{ job: Job | null }>(null, `?id=${id}`).then((d) => openJob(d.job)).catch(() => undefined);
  }, [refreshList, openJob]);

  // Follow a reel while GitHub renders it.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "rendering")) return;
    const timer = setInterval(() => {
      api<{ job: Job | null }>(null, `?id=${job.id}`)
        .then((d) => {
          if (d.job && d.job.status !== job.status) {
            setJob(d.job);
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

  const writeScript = (withFeedback: boolean) =>
    step(withFeedback ? "Хасрой переписывает сценарий…" : "Хасрой пишет сценарий…", async () => {
      const d = await api<{ job: Job }>({
        action: "script",
        id: job?.status === "draft" || job?.status === "failed" ? job.id : undefined,
        brief,
        previous: withFeedback ? script : undefined,
        feedback: withFeedback ? feedback : undefined,
      });
      openJob(d.job);
      setFeedback("");
      setFixes([]);
      refreshList();
    });

  const buildPlan = () =>
    step("Хасрой подбирает инструменты…", async () => {
      const d = await api<{ job: Job; fixes: string[] }>({
        action: "plan",
        id: job?.status === "draft" || job?.status === "failed" ? job.id : undefined,
        brief,
        script,
      });
      openJob(d.job);
      setFixes(d.fixes ?? []);
      refreshList();
    });

  const render = () =>
    step("Ставлю в очередь…", async () => {
      if (!job) return;
      const d = await api<{ job: Job }>({ action: "render", id: job.id });
      setJob(d.job);
      refreshList();
    });

  const editScene = (i: number, patch: Partial<Scene>) => {
    if (!script) return;
    setDirty(true);
    setScript({ ...script, scenes: script.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  };

  const planJson = job?.plan ? JSON.stringify(job.plan) : "";
  const planStale = Boolean(job?.plan && dirty);
  const total = script ? script.scenes.reduce((n, s) => n + (Number(s.seconds) || 0), 0) : 0;
  const editable = !job || job.status === "draft" || job.status === "failed" || job.status === "done";

  if (unauthorized) {
    return (
      <main className={styles.page} style={{ display: "block", maxWidth: "none", padding: 0 }}>
        <div className={styles.gate}>
          <p>Рилсы доступны только владельцу.</p>
          <a className={styles.primary} href="/owner">Войти в консоли</a>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} style={{ display: "block", maxWidth: "none", padding: 0 }}>
      <header className={styles.top}>
        <a href="/owner" className={styles.back}><ArrowLeft size={16} /> Консоль</a>
        <h1><Clapperboard size={22} /> Рилсы ИИнны</h1>
        <button type="button" className={styles.ghost} onClick={() => { setJob(null); setScript(null); setBrief(""); setFixes([]); window.history.replaceState(null, "", "/owner/reels"); }}>
          <Plus size={15} /> Новый
        </button>
      </header>

      <div className={styles.grid}>
        <section className={styles.work}>
          <div className={styles.card}>
            <label className={styles.label} htmlFor="brief">1 · О чём ролик</label>
            <textarea
              id="brief"
              className={styles.brief}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="Например: рилс про то, что ИИнна понимает голосовые сообщения"
            />
            {!brief && !script ? (
              <div className={styles.examples}>
                {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setBrief(x)}>{x}</button>)}
              </div>
            ) : null}
            <button type="button" className={styles.primary} disabled={!brief.trim() || !!busy || !editable} onClick={() => writeScript(false)}>
              <Sparkles size={16} /> {script ? "Написать заново" : "Написать сценарий"}
            </button>
          </div>

          {script ? (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.label}>2 · Сценарий — правьте прямо здесь</span>
                <span className={styles.muted}>{script.scenes.length} сцен · ~{Math.round(total)} с</span>
              </div>
              <input className={styles.title} value={script.title} onChange={(e) => { setDirty(true); setScript({ ...script, title: e.target.value }); }} aria-label="Название ролика" />
              {script.idea ? <p className={styles.idea}>{script.idea}</p> : null}
              <ol className={styles.scenes}>
                {script.scenes.map((s, i) => (
                  <li key={i}>
                    <div className={styles.sceneTop}>
                      <b>{i + 1}</b>
                      <input
                        className={styles.text}
                        value={s.text}
                        onChange={(e) => editScene(i, { text: e.target.value })}
                        placeholder="Надпись на экране"
                        aria-label={`Надпись сцены ${i + 1}`}
                      />
                      <input
                        className={styles.secs}
                        type="number"
                        min={1}
                        max={6}
                        step={0.5}
                        value={s.seconds}
                        onChange={(e) => editScene(i, { seconds: Number(e.target.value) })}
                        aria-label={`Секунды сцены ${i + 1}`}
                      />
                      <button type="button" className={styles.icon} aria-label="Убрать сцену" onClick={() => { setDirty(true); setScript({ ...script, scenes: script.scenes.filter((_, k) => k !== i) }); }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <textarea className={styles.what} rows={1} value={s.what} onChange={(e) => editScene(i, { what: e.target.value })} placeholder="Что в кадре" aria-label={`Кадр сцены ${i + 1}`} />
                  </li>
                ))}
              </ol>
              <button type="button" className={styles.ghost} onClick={() => { setDirty(true); setScript({ ...script, scenes: [...script.scenes, { seconds: 2.5, what: "", text: "" }] }); }}>
                <Plus size={14} /> Сцена
              </button>
              <div className={styles.feedback}>
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Что поменять? Например: крючок резче, меньше текста" aria-label="Правки к сценарию" />
                <button type="button" className={styles.ghost} disabled={!feedback.trim() || !!busy || !editable} onClick={() => writeScript(true)}>
                  <RefreshCw size={14} /> Переписать
                </button>
              </div>
              <button type="button" className={styles.primary} disabled={!!busy || !editable || !script.scenes.length} onClick={buildPlan}>
                <Wand2 size={16} /> {job?.plan ? "Пересобрать превью" : "Утвердить и собрать превью"}
              </button>
            </div>
          ) : null}

          {busy ? <p className={styles.status}><span className={styles.pulse} />{busy}</p> : null}
          {waiting ? (
            <div className={styles.wait} role="status">
              <b>Лимит моделей закончился — жду</b>
              <span>Повторю сам в {new Date(waiting.until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} (через {waitLabel(waiting.until - now)}).</span>
              <button type="button" className={styles.ghost} onClick={() => setWaiting(null)}>Отменить</button>
            </div>
          ) : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>

        <section className={styles.side}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.label}>3 · Превью</span>
              {job ? <span className={styles.badge} data-status={job.status}>{STATUS[job.status]}</span> : null}
            </div>
            <div className={styles.phone}>
              {planJson ? (
                <iframe key={planJson} title="Превью рилса" src={`/reels-runtime/index.html#${encodeURIComponent(planJson)}`} />
              ) : (
                <p>Утвердите сценарий — здесь сразу появится живое превью из инструментов.</p>
              )}
            </div>
            {planStale ? <p className={styles.muted}>Сценарий изменён — нажмите «Пересобрать превью».</p> : null}
            {fixes.length ? (
              <details className={styles.fixes}>
                <summary>Проверка поправила {fixes.length}</summary>
                <ul>{fixes.map((f) => <li key={f}>{f}</li>)}</ul>
              </details>
            ) : null}
            {job?.plan ? (
              <button
                type="button"
                className={styles.primary}
                disabled={!!busy || planStale || job.status === "queued" || job.status === "rendering"}
                onClick={render}
              >
                <Clapperboard size={16} /> {job.status === "done" ? "Собрать заново" : "Собрать видео"}
              </button>
            ) : null}
            {job?.status === "queued" ? (
              <p className={styles.status}><span className={styles.pulse} />В очереди. GitHub проверяет очередь каждые 5 минут — обычно видео готово через 5–15 минут. Можно закрыть страницу.</p>
            ) : null}
            {job?.status === "rendering" ? <p className={styles.status}><span className={styles.pulse} />Собирается на GitHub (около 2 минут)…</p> : null}
            {job?.status === "failed" ? <p className={styles.error}>{job.error || "Сборка не удалась."} Можно собрать заново.</p> : null}
          </div>

          {job?.status === "done" && job.video_url ? (
            <div className={styles.card}>
              <span className={styles.label}>Готовое видео</span>
              <video className={styles.video} src={job.video_url} controls playsInline preload="metadata" />
              <a className={styles.ghost} href={job.video_url} download target="_blank" rel="noopener noreferrer"><Download size={14} /> Скачать MP4</a>
            </div>
          ) : null}

          {list.length ? (
            <div className={styles.card}>
              <span className={styles.label}>Последние</span>
              <ul className={styles.history}>
                {list.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => api<{ job: Job | null }>(null, `?id=${r.id}`).then((d) => { openJob(d.job); setFixes([]); })} data-active={r.id === job?.id || undefined}>
                      <span>{r.title || "Без названия"}</span>
                      <span className={styles.badge} data-status={r.status}>{STATUS[r.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
