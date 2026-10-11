"use client";

import { FormEvent, memo, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, PanelLeft, PanelRight, Plus, ShieldCheck } from "lucide-react";
import { Core } from "@/components/khasroy/core";
import { MarkdownMessage } from "@/components/khasroy/markdown-message";
import { LeftBoard, RightBoard, useOwnerDashboard } from "./console-boards";
import styles from "./console.module.css";
import {
  authenticateOwner,
  chat,
  KhasroyAuthError,
  type ChatProgress,
  type Message,
} from "@/lib/chat";

const welcome: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Я на связи. Слева — ваши инструменты и их цифры, справа — моё состояние. С чего начнём?",
};

// Only the message that is still typing re-renders; finished ones keep their markup.
const Bubble = memo(function Bubble({ role, content }: { role: Message["role"]; content: string }) {
  return (
    <article className={role === "user" ? styles.me : styles.ai}>
      {role === "assistant" ? <MarkdownMessage content={content} /> : <p>{content}</p>}
    </article>
  );
});

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState(false);
  const [progressLog, setProgressLog] = useState<ChatProgress[]>([]);
  const responseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (responseTimer.current) clearTimeout(responseTimer.current); }, []);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const pendingMessages = useRef<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const followRef = useRef<() => void>(() => undefined);
  const lastOwnerMessage = useRef("");
  const [atBottom, setAtBottom] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // On narrow screens the side boards are drawers over the chat, so they start closed.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1100px)").matches) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);
  const dashboard = useOwnerDashboard();
  const field = useRef<HTMLTextAreaElement>(null);


  // Follow the conversation only while the reader is at the bottom. Any upward wheel, touch
  // or key scroll releases it at once; it re-attaches only when the reader returns to the very
  // bottom or presses the "к новому" button. Our own scrollTop writes are ignored by the
  // scroll listener, so a growing answer can never re-capture a reader who scrolled away.
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    let ownScroll = -1;
    let touching = false;
    let frame = 0;
    const release = () => {
      if (!stickToBottom.current) return;
      stickToBottom.current = false;
      setAtBottom(false);
    };
    const distance = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const onScroll = () => {
      if (ownScroll >= 0 && Math.abs(el.scrollTop - ownScroll) < 2) return;
      ownScroll = -1;
      const bottomNow = distance() < 6;
      if (bottomNow && !touching) {
        stickToBottom.current = true;
        setAtBottom(true);
      } else if (!bottomNow) release();
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) release(); };
    const onTouchStart = () => { touching = true; };
    const onTouchMove = () => release();
    const onTouchEnd = () => { touching = false; };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) release();
    };
    const follow = () => {
      if (!stickToBottom.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!stickToBottom.current) return;
        el.scrollTop = el.scrollHeight;
        ownScroll = el.scrollTop;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("keydown", onKey);
    const observer = new ResizeObserver(follow);
    for (const child of Array.from(el.children)) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(el.children)) observer.observe(child);
      follow();
    });
    mutations.observe(el, { childList: true });
    followRef.current = follow;
    follow();
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("keydown", onKey);
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);

  useEffect(() => {
    // A new message from the owner always brings the view back down.
    const last = messages[messages.length - 1];
    if (last?.role === "user" && last.id !== lastOwnerMessage.current) {
      lastOwnerMessage.current = last.id;
      stickToBottom.current = true;
      setAtBottom(true);
    }
    followRef.current();
  }, [messages, busy, progressLog]);

  async function finishChat(next: Message[]) {
    const assistantId = crypto.randomUUID();
    setProgressLog([]);
    setMessages([...next, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const content = await chat(next, {
        onProgress(progress) {
          setProgressLog((previous) => {
            if (previous[previous.length - 1]?.message === progress.message) return previous;
            return [...previous.slice(-7), progress];
          });
        },
        onChunk(_delta, full) {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === assistantId ? { ...message, content: full } : message,
            ),
          );
        },
      });

      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantId ? { ...message, content } : message,
        ),
      );
      setResponding(true);
      if (responseTimer.current) clearTimeout(responseTimer.current);
      responseTimer.current = setTimeout(() => setResponding(false), 3600);
      dashboard.refresh();
    } catch (err) {
      setMessages(next);
      setProgressLog([]);
      throw err;
    }
  }

  async function send(value = input) {
    if (!value.trim() || busy) return;

    const next: Message[] = [
      ...messages.filter((message) => message.content.trim()),
      { id: crypto.randomUUID(), role: "user", content: value.trim() },
    ];

    setMessages(next);
    setInput("");
    setBusy(true);
    setResponding(false);
    setProgressLog([]);
    if (responseTimer.current) clearTimeout(responseTimer.current);
    setError("");

    try {
      await finishChat(next);
    } catch (err) {
      if (err instanceof KhasroyAuthError) {
        pendingMessages.current = next;
        setAuthError("");
        setAuthOpen(true);
        return;
      }

      setError(
        err instanceof Error
          ? err.message
          : "Не удалось получить ответ. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
      setProgressLog([]);
      field.current?.focus();
    }
  }

  async function submitOwnerKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ownerKey.trim() || authBusy) return;

    setAuthBusy(true);
    setAuthError("");

    try {
      const authenticated = await authenticateOwner(ownerKey.trim());
      if (!authenticated) {
        setAuthError("Неверный ключ владельца.");
        return;
      }

      setAuthOpen(false);
      setOwnerKey("");
      dashboard.refresh();
      const queued = pendingMessages.current;
      pendingMessages.current = null;

      if (queued) {
        setBusy(true);
        try {
          await finishChat(queued);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Не удалось получить ответ. Попробуйте ещё раз.",
          );
        } finally {
          setBusy(false);
          setProgressLog([]);
        }
      }
    } catch {
      setAuthError("Не удалось проверить ключ. Попробуйте ещё раз.");
    } finally {
      setAuthBusy(false);
    }
  }

  const latestProgress = progressLog[progressLog.length - 1];
  const coreState = responding ? "responding" : busy ? "thinking" : focused ? "listening" : "idle";
  const typing = busy || responding;

  function jumpToLatest() {
    const el = log.current;
    stickToBottom.current = true;
    setAtBottom(true);
    if (el) el.scrollTop = el.scrollHeight;
  }

  function newDialog() {
    setMessages([welcome]);
    setResponding(false);
    setProgressLog([]);
    if (responseTimer.current) clearTimeout(responseTimer.current);
    setInput("");
    setError("");
    field.current?.focus();
  }

  return (
    // Global CSS turns every <main> into the old console grid; this page lays itself out.
    <main className={styles.page} style={{ display: "block", maxWidth: "none", padding: 0 }}>
      <div
        className={styles.layout}
        data-left={leftOpen ? "open" : "closed"}
        data-right={rightOpen ? "open" : "closed"}
      >
        <aside className={`${styles.side} ${styles.left}`} aria-label="Инструменты">
          <div className={styles.sideHead}>
            <a href="/owner" className={styles.brand}>ХАСРОЙ</a>
            <span className={styles.sideHint}>инструменты</span>
            <button type="button" className={styles.iconButton} onClick={() => setLeftOpen(false)} aria-label="Свернуть инструменты">
              <ChevronLeft size={15} />
            </button>
          </div>
          <LeftBoard data={dashboard.data} loading={dashboard.loading} unauthorized={dashboard.unauthorized} onLogin={() => setAuthOpen(true)} />
        </aside>

        <section className={styles.center} aria-label="Чат с Хасроем">
          <div className={styles.topBar}>
            {!leftOpen ? (
              <button type="button" className={styles.iconButton} onClick={() => setLeftOpen(true)} aria-label="Показать инструменты">
                <PanelLeft size={15} />
              </button>
            ) : <span />}
            <div className={styles.attention}>
              {(dashboard.data?.attention ?? []).slice(0, 3).map((item) => (
                <span key={item} className={styles.alert}>{item}</span>
              ))}
            </div>
            <div className={styles.topActions}>
              <button type="button" className={styles.pillButton} disabled={busy} onClick={newDialog}>
                <Plus size={14} /> Новый диалог
              </button>
              {!rightOpen ? (
                <button type="button" className={styles.iconButton} onClick={() => setRightOpen(true)} aria-label="Показать состояние Хасроя">
                  <PanelRight size={15} />
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.cloud} data-state={coreState}>
            <Core state={coreState} />
          </div>

          <div ref={log} className={styles.messages} role="log" aria-live="polite" aria-label="История сообщений">
            <div className={styles.spacer} />
            {messages.filter((m) => m.role === "user" || m.content).map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} />
            ))}
            {busy ? (
              <div className={styles.progress} role="status" aria-live="polite">
                <strong><span className={styles.pulse} />{latestProgress?.message || "Хасрой начинает задачу…"}</strong>
                {progressLog.length > 1 ? (
                  <div className={styles.steps}>
                    {progressLog.slice(-5, -1).map((item, index) => (
                      <span key={`${item.stage || "step"}-${index}`}>✓ {item.message}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div ref={bottom} />
          </div>

          {!atBottom ? (
            <button type="button" className={styles.jump} onClick={jumpToLatest}>
              <ArrowDown size={14} /> {typing ? "Хасрой печатает — к новому" : "К последнему сообщению"}
            </button>
          ) : null}

          {messages.length === 1 && !busy ? (
            <div className={styles.suggestions}>
              {["Что изменилось в коде за сегодня?", "Найди слабые места в Хасрое", "Найди свежие новости об ИИ"].map((text) => (
                <button key={text} type="button" onClick={() => send(text)}>{text}</button>
              ))}
            </div>
          ) : null}

          {error ? <p role="alert" className={styles.error}>{error}</p> : null}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              ref={field}
              value={input}
              maxLength={4000}
              rows={1}
              placeholder="Спросите Хасроя или дайте задачу…"
              aria-label="Сообщение для Хасроя"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className={styles.send} aria-label="Отправить сообщение" disabled={!input.trim() || busy}>
              <ArrowUp size={19} />
            </button>
          </form>
        </section>

        <aside className={`${styles.side} ${styles.right}`} aria-label="Состояние Хасроя">
          <div className={styles.sideHead}>
            <button type="button" className={styles.iconButton} onClick={() => setRightOpen(false)} aria-label="Свернуть состояние">
              <ChevronRight size={15} />
            </button>
          </div>
          <RightBoard data={dashboard.data} loading={dashboard.loading} unauthorized={dashboard.unauthorized} coreState={coreState} onLogin={() => setAuthOpen(true)} />
        </aside>
      </div>

      {authOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Вход владельца Хасроя"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(1, 8, 12, 0.82)",
            backdropFilter: "blur(14px)",
          }}
        >
          <form
            onSubmit={submitOwnerKey}
            style={{
              width: "min(440px, 100%)",
              border: "1px solid rgba(102, 214, 235, 0.28)",
              borderRadius: 18,
              padding: 24,
              background: "rgba(5, 17, 24, 0.98)",
              boxShadow: "0 24px 90px rgba(0,0,0,.55), 0 0 45px rgba(69,190,220,.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <ShieldCheck size={24} />
              <strong style={{ fontSize: 17, letterSpacing: ".06em" }}>ДОСТУП ВЛАДЕЛЬЦА</strong>
            </div>
            <p style={{ margin: "0 0 18px", opacity: 0.66, lineHeight: 1.55, fontSize: 14 }}>
              Введите ваш личный ключ KHASROY_OWNER_KEY. Он отправляется только на сервер Хасроя и не сохраняется в браузере как обычный текст.
            </p>
            <input
              autoFocus
              type="password"
              value={ownerKey}
              onChange={(event) => setOwnerKey(event.target.value)}
              placeholder="Ключ владельца"
              autoComplete="current-password"
              style={{
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid rgba(113, 213, 235, .28)",
                borderRadius: 12,
                background: "rgba(255,255,255,.035)",
                color: "inherit",
                padding: "14px 15px",
                outline: "none",
                fontSize: 15,
              }}
            />
            {authError && (
              <p role="alert" style={{ margin: "10px 0 0", color: "#ff8f8f", fontSize: 13 }}>
                {authError}
              </p>
            )}
            <button
              type="submit"
              disabled={!ownerKey.trim() || authBusy}
              style={{
                width: "100%",
                marginTop: 16,
                border: 0,
                borderRadius: 12,
                padding: "13px 16px",
                cursor: authBusy ? "wait" : "pointer",
                background: "#8adbea",
                color: "#041016",
                fontWeight: 700,
                letterSpacing: ".04em",
                opacity: !ownerKey.trim() || authBusy ? 0.55 : 1,
              }}
            >
              {authBusy ? "ПРОВЕРЯЮ…" : "ВОЙТИ КАК ВЛАДЕЛЕЦ"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
