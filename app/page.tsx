"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Activity, Sparkles, ShieldCheck } from "lucide-react";
import { Core, type CoreEvolution } from "@/components/khasroy/core";
import {
  authenticateOwner,
  chat,
  KhasroyAuthError,
  type Message,
} from "@/lib/chat";

const welcome: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "Все системы готовы. Я Хасрой — ваш универсальный AI-союзник. У меня активна долговременная память между сессиями. С чего начнём?",
};

// Core Evolution grows only from verified capabilities.
// v0.3 has three confirmed foundations: intelligence, owner protection and long-term memory.
const coreEvolution: CoreEvolution = {
  level: 3,
  skills: 3,
  knowledge: 0,
  testsPassed: 1,
  capabilities: {
    intelligence: 1,
    security: 1,
    code: 0,
    memory: 1,
    internet: 0,
    vision: 0,
    voice: 0,
    agents: 0,
    images: 0,
  },
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [ownerKey, setOwnerKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const pendingMessages = useRef<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  async function finishChat(next: Message[]) {
    const content = await chat(next);
    setMessages([
      ...next,
      { id: crypto.randomUUID(), role: "assistant", content },
    ]);
  }

  async function send(value = input) {
    if (!value.trim() || busy) return;

    const next: Message[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: value.trim() },
    ];

    setMessages(next);
    setInput("");
    setBusy(true);
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
        }
      }
    } catch {
      setAuthError("Не удалось проверить ключ. Попробуйте ещё раз.");
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-symbol">Х</span>
          <span>
            Хасрой<span className="version">v0.3</span>
          </span>
        </a>
        <div className="online">
          <span />Хасрой ONLINE
        </div>
        <span className="header-meta">EVOLVING CODE INTELLIGENCE</span>
      </header>

      <section className="stage" aria-label="AI-ядро">
        <aside className="system">
          <div className="eyebrow">
            <Activity size={14} /> SYSTEM STATUS
          </div>
          <dl>
            <div>
              <dt>Ядро</dt>
              <dd>Активно</dd>
            </div>
            <div>
              <dt>Режим</dt>
              <dd>Облачный</dd>
            </div>
            <div>
              <dt>AI-модель</dt>
              <dd>GPT-OSS 120B</dd>
            </div>
            <div>
              <dt>Память</dt>
              <dd>VERIFIED</dd>
            </div>
            <div>
              <dt>Эволюция</dt>
              <dd>LEVEL 03</dd>
            </div>
          </dl>
          <div className="signal">
            {Array.from({ length: 24 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <p>3 VERIFIED CAPABILITIES</p>
        </aside>

        <div className="core-wrap">
          <Core
            state={busy ? "thinking" : focused ? "listening" : "idle"}
            evolution={coreEvolution}
          />
          <span className="core-coordinate coord-left">
            CORE EVOLUTION
            <br />LEVEL 03
          </span>
          <span className="core-coordinate coord-right">
            {busy ? "PROCESSING" : "STANDBY"}
            <br />● ACTIVE
          </span>
        </div>

        <div className="core-caption">
          <span className="eyebrow">
            {busy
              ? "АНАЛИЗИРУЮ ЗАПРОС"
              : focused
                ? "СЛУШАЮ ВЛАДЕЛЬЦА"
                : "НА СВЯЗИ. ПАМЯТЬ АКТИВНА."}
          </span>
          <h1>Мысль. Код. Развитие.</h1>
          <p>Каждая подтверждённая способность меняет ядро.</p>
        </div>
        <div className="stage-index">03 / CORE EVOLUTION</div>
      </section>

      <section className="chat" aria-label="Чат с «Хасрой»">
        <div className="chat-heading">
          <div>
            <span className="chat-indicator" />
            Диалог <span className="demo">LIVE</span>
          </div>
          <button
            className="new-chat"
            disabled={busy}
            onClick={() => {
              setMessages([welcome]);
              setInput("");
              setError("");
              field.current?.focus();
            }}
          >
            <Plus size={16} />Новый диалог
          </button>
        </div>

        <div
          className="messages"
          role="log"
          aria-live="polite"
          aria-label="История сообщений"
        >
          {messages.map((m) => (
            <article className={`message ${m.role}`} key={m.id}>
              <div className="avatar">
                {m.role === "assistant" ? <Sparkles size={16} /> : "ВЫ"}
              </div>
              <div>
                <div className="message-label">
                  {m.role === "assistant" ? "Хасрой" : "ВЫ"}
                  {m.role === "assistant" && <span>AI RESPONSE</span>}
                </div>
                <p>{m.content}</p>
              </div>
            </article>
          ))}
          {busy && (
            <div className="typing" role="status">
              <i />
              <i />
              <i />
              <span>Хасрой думает</span>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {messages.length === 1 && !busy && (
          <div className="suggestions">
            {["Что ты помнишь?", "Разбери архитектуру проекта", "Помоги написать код"].map(
              (text) => (
                <button key={text} onClick={() => send(text)}>
                  {text}
                  <span>↗</span>
                </button>
              ),
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <form
          className="composer"
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
            placeholder="Напишите «Хасрой»…"
            aria-label="Сообщение для «Хасрой»"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            type="submit"
            className="send"
            aria-label="Отправить сообщение"
            disabled={!input.trim() || busy}
          >
            <ArrowUp size={21} />
          </button>
        </form>

        <div className="chat-footer">
          <span>LIVE AI · MEMORY VERIFIED · Доступ владельца</span>
          <span>Enter — отправить ↵</span>
        </div>
      </section>

      <footer className="page-footer">
        <span>Хасрой LAB / v0.3</span>
        <span>CORE EVOLUTION / LEVEL 03</span>
      </footer>

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
