"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Activity, Sparkles } from "lucide-react";
import { Core } from "@/components/khasroy/core";
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
    "Все системы готовы. Я Хасрой — ваш универсальный AI-союзник. Можем работать с идеями, кодом и сложными задачами. С чего начнём?",
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

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
      let content: string;

      try {
        content = await chat(next);
      } catch (err) {
        if (!(err instanceof KhasroyAuthError)) throw err;

        const key = window.prompt("Введите ключ владельца Хасроя");
        if (!key) {
          setError("Для доступа к AI нужен ключ владельца.");
          return;
        }

        const authenticated = await authenticateOwner(key);
        if (!authenticated) {
          setError("Неверный ключ владельца.");
          return;
        }

        content = await chat(next);
      }

      setMessages([
        ...next,
        { id: crypto.randomUUID(), role: "assistant", content },
      ]);
    } catch (err) {
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

  return (
    <main>
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-symbol">Х</span>
          <span>
            Хасрой<span className="version">v0.2</span>
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
              <dd>GPT-5.6</dd>
            </div>
          </dl>
          <div className="signal">
            {Array.from({ length: 24 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <p>LIVE SESSION / 001</p>
        </aside>

        <div className="core-wrap">
          <Core state={busy ? "thinking" : focused ? "listening" : "idle"} />
          <span className="core-coordinate coord-left">
            NEURAL CORE
            <br />Х — 02
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
                : "НА СВЯЗИ. ГОТОВ К РАБОТЕ."}
          </span>
          <h1>Мысль. Код. Развитие.</h1>
          <p>Интеллект, который мы будем расширять шаг за шагом.</p>
        </div>
        <div className="stage-index">02 / INTELLIGENCE CORE</div>
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
            {["Что ты умеешь?", "Разбери архитектуру проекта", "Помоги написать код"].map(
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
          <span>LIVE AI · Доступ защищён ключом владельца</span>
          <span>Enter — отправить ↵</span>
        </div>
      </section>

      <footer className="page-footer">
        <span>Хасрой LAB / v0.2</span>
        <span>EVOLVING CODE INTELLIGENCE</span>
      </footer>
    </main>
  );
}
