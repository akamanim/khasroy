"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Maximize2, Minimize2, Play, RotateCw } from "lucide-react";
import styles from "./console.module.css";

type BrowserState = { url: string; scrollY: number; cookies: unknown[] };
type View = { url: string; title: string; screenshot: string };
type Step = { n: number; thought: string; action: string; model: string };
type Confirm = { question: string; index: number; label: string };

const EMPTY: BrowserState = { url: "", scrollY: 0, cookies: [] };
const STORE = "khasroy.cloud-browser";
const WIDTH = 1280;
const HEIGHT = 800;
const AUTO_CONTINUE = 4;

function load(): { state: BrowserState; view: View | null } {
  try {
    const raw = sessionStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as { state: BrowserState; view: View | null };
  } catch {
    // Private mode or blocked storage: start empty.
  }
  return { state: EMPTY, view: null };
}

export function CloudBrowser({ unauthorized, onLogin }: { unauthorized: boolean; onLogin: () => void }) {
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [view, setView] = useState<View | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [large, setLarge] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [paused, setPaused] = useState<{ goal: string; history: string[] } | null>(null);
  const stepsBox = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const saved = load();
    setState(saved.state);
    setView(saved.view);
    if (saved.view?.url) setAddress(saved.view.url);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ state, view }));
    } catch {
      // Storage full (large screenshot) or blocked: the session still works in memory.
    }
  }, [state, view]);

  useEffect(() => {
    const box = stepsBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [steps.length]);

  useEffect(() => {
    if (!large) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setLarge(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large]);

  async function act(body: Record<string, unknown>, label: string): Promise<BrowserState | null> {
    setBusy(label);
    setError("");
    try {
      const response = await fetch("/api/owner/browser", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, state }),
      });
      const data = (await response.json().catch(() => ({}))) as View & { state?: BrowserState; error?: string };
      if (response.status === 401) throw new Error("Войдите как владелец, чтобы пользоваться браузером.");
      if (!response.ok || data.error) throw new Error(data.error || `Браузер ответил ошибкой ${response.status}`);
      setView({ url: data.url, title: data.title, screenshot: data.screenshot });
      if (data.state) setState(data.state);
      if (data.url) setAddress(data.url);
      return data.state ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function runTask(task: string, history: string[], continued = 0, start: BrowserState = state): Promise<void> {
    setBusy("Хасрой работает…");
    setError("");
    setConfirm(null);
    setPaused(null);
    if (!history.length) {
      setSteps([]);
      setAnswer("");
    }
    let current = start;
    try {
      const response = await fetch("/api/owner/browser", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "task", goal: task, history, state: current }),
      });
      if (response.status === 401) throw new Error("Войдите как владелец, чтобы пользоваться браузером.");
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Браузер ответил ошибкой ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let next: { history: string[] } | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Record<string, unknown> & { type: string };
          if (event.shot || event.screenshot) {
            setView({ url: String(event.url ?? ""), title: String(event.title ?? ""), screenshot: String(event.shot ?? event.screenshot) });
            if (event.url) setAddress(String(event.url));
          }
          if (event.state) {
            current = event.state as BrowserState;
            setState(current);
          }
          if (event.type === "step") {
            setSteps((prev) => [...prev, { n: Number(event.n), thought: String(event.thought), action: String(event.action), model: String(event.model ?? "") }]);
          } else if (event.type === "done") {
            setAnswer(String(event.answer));
          } else if (event.type === "confirm") {
            setConfirm({ question: String(event.question), index: Number(event.index), label: String(event.label) });
            setPaused({ goal: task, history: event.history as string[] });
          } else if (event.type === "paused") {
            next = { history: event.history as string[] };
          } else if (event.type === "error") {
            throw new Error(String(event.message));
          }
        }
      }
      if (next) {
        // One request lasts under a minute; long tasks continue in the next one on their own.
        if (continued < AUTO_CONTINUE) return runTask(task, next.history, continued + 1, current);
        setPaused({ goal: task, history: next.history });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  function submitAddress(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!address.trim() || busy) return;
    setPoint(null);
    void act({ action: "goto", url: address }, "Открываю…");
  }

  function clickShot(event: MouseEvent<HTMLImageElement>) {
    if (busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * WIDTH);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * HEIGHT);
    setPoint({ x, y });
    void act({ action: "click", x, y }, "Нажимаю…");
  }

  function submitTyped(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!typed.trim() || !point || busy) return;
    void act({ action: "type", x: point.x, y: point.y, text: typed, enter: true }, "Ввожу текст…");
    setTyped("");
  }

  function submitGoal(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!goal.trim() || busy) return;
    void runTask(goal.trim(), []);
  }

  async function approve() {
    if (!confirm || !paused) return;
    const { goal: task, history } = paused;
    const label = confirm.label;
    setConfirm(null);
    const after = await act({ action: "click", index: confirm.index, label }, "Нажимаю по вашему подтверждению…");
    if (after) void runTask(task, [...history, `Владелец подтвердил и нажал «${label}»`], 0, after);
  }

  if (unauthorized) {
    return (
      <section className={`${styles.panel} ${styles.browser}`}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Облачный браузер</span>
        </header>
        <p className={styles.muted}>Браузер доступен только владельцу.</p>
        <button type="button" className={styles.pillButton} onClick={onLogin}>Войти</button>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${styles.browser} ${large ? styles.browserLarge : ""}`} aria-label="Облачный браузер">
      <header className={styles.panelHead}>
        <span className={styles.label}>Облачный браузер</span>
        <span className={busy ? styles.accent : styles.muted}>{busy || (view?.url ? "готов" : "пусто")}</span>
        <button type="button" className={styles.iconButton} onClick={() => setLarge((v) => !v)} aria-label={large ? "Свернуть браузер" : "Развернуть браузер"}>
          {large ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </header>

      <div className={styles.browserBody}>
        <div className={styles.browserMain}>
          <form className={styles.browserBar} onSubmit={submitAddress}>
            <button type="button" aria-label="Назад" disabled={!!busy || !state.url} onClick={() => act({ action: "back" }, "Назад…")}><ArrowLeft size={13} /></button>
            <button type="button" aria-label="Обновить" disabled={!!busy || !state.url} onClick={() => act({ action: "reload" }, "Обновляю…")}><RotateCw size={13} /></button>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="адрес сайта, например kelshi.kz"
              aria-label="Адрес сайта"
              inputMode="url"
              autoCapitalize="off"
              spellCheck={false}
            />
          </form>

          <div className={styles.browserView} data-busy={busy ? "true" : undefined}>
            {view?.screenshot ? (
              // eslint-disable-next-line @next/next/no-img-element -- live screenshot from the cloud browser
              <img src={`data:image/jpeg;base64,${view.screenshot}`} alt={view.title || view.url} onClick={clickShot} />
            ) : (
              <p>Введите адрес сверху или дайте Хасрою задачу внизу — здесь будет видно, что он делает.</p>
            )}
            {busy ? <span className={styles.browserBusy}>{busy}</span> : null}
          </div>

          {view?.screenshot ? (
            <div className={styles.browserTools}>
              <button type="button" disabled={!!busy} onClick={() => act({ action: "scroll", direction: "up" }, "Листаю…")} aria-label="Листать вверх"><ArrowUp size={13} /></button>
              <button type="button" disabled={!!busy} onClick={() => act({ action: "scroll", direction: "down" }, "Листаю…")} aria-label="Листать вниз"><ArrowDown size={13} /></button>
              <form onSubmit={submitTyped}>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={point ? "Текст в поле, где нажали" : "Нажмите на поле на снимке"}
                  disabled={!point}
                  aria-label="Текст для выбранного поля"
                />
              </form>
            </div>
          ) : null}
        </div>

        <div className={styles.browserSide}>
          <form className={styles.browserTask} onSubmit={submitGoal}>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="Задача: посмотри kelshi.kz и выпиши цены"
              aria-label="Задача для Хасроя в браузере"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submitGoal(e);
              }}
            />
            <button type="submit" disabled={!goal.trim() || !!busy} aria-label="Выполнить задачу"><Play size={14} /></button>
          </form>

          {steps.length ? (
            <ol ref={stepsBox} className={styles.browserSteps}>
              {steps.map((s) => (
                <li key={`${s.n}-${s.action}`}>
                  <b>{s.action}</b>
                  <span>{s.thought}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {confirm ? (
            <div className={styles.browserConfirm} role="alert">
              <p>{confirm.question}</p>
              <span>Хасрой остановился: это действие может что-то купить, отправить или войти в аккаунт.</span>
              <div>
                <button type="button" className={styles.pillButton} onClick={approve} disabled={!!busy}>Подтвердить</button>
                <button type="button" className={styles.pillButton} onClick={() => { setConfirm(null); setPaused(null); }}>Отмена</button>
              </div>
            </div>
          ) : null}

          {paused && !confirm ? (
            <button type="button" className={styles.pillButton} disabled={!!busy} onClick={() => runTask(paused.goal, paused.history)}>
              Продолжить задачу
            </button>
          ) : null}

          {answer ? <div className={styles.browserAnswer}>{answer}</div> : null}
          {error ? <p className={styles.bad} role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
