"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import styles from "./sales.module.css";

type Card = { id: string; name: string; price: string; photo: string; link: string; stock: string };
type Turn = { role: "user" | "assistant"; content: string; products?: Card[]; note?: string; model?: string };

function priceLabel(price: string, currency: string) {
  if (!price) return "";
  return /^\d[\d\s.,]*$/u.test(price) && currency ? `${price.replace(/\B(?=(\d{3})+(?!\d))/gu, " ")} ${currency}` : price;
}

function modelLabel(model: string) {
  if (model.includes("llama")) return `Llama 3.3 · ${model.replace(/^openrouter:/u, "OpenRouter · ")}`;
  if (model.startsWith("openai/gpt-oss")) return `GPT-OSS · ${model}`;
  return model;
}

const STAGE_LABELS: Record<string, string> = {
  greeting: "приветствие",
  qualification: "выяснение потребности",
  proposal: "предложение",
  closing: "закрытие",
  finished: "контакт получен",
};
const DATA_LABELS: Record<string, string> = { need: "потребность", budget: "бюджет", timeline: "срок", product_interest: "интерес", contact: "контакт" };
const SESSION_KEY = "kh_sales_b_session";

function storedSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function SalesChat({
  shop,
  currency,
  count,
  variant = "a",
}: {
  shop: string;
  currency: string;
  count: number;
  variant?: "a" | "b";
}) {
  const greeting: Turn = {
    role: "assistant",
    content: `Здравствуйте! Я консультант магазина ${shop}. Подскажу по товарам, ценам, наличию и доставке. Что ищете?`,
  };
  const [turns, setTurns] = useState<Turn[]>([greeting]);
  const [sessionId, setSessionId] = useState("");
  const [funnel, setFunnel] = useState<{ stage: string; data: Record<string, string> } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);

  // Variant B keeps the conversation on the server; restore it after a reload.
  useEffect(() => {
    if (variant !== "b") return;
    const id = storedSessionId();
    setSessionId(id);
    fetch("/api/sales/b", { headers: { "x-session-id": id } })
      .then((r) => r.json() as Promise<{ stage?: string; data?: Record<string, string>; messages?: Turn[] }>)
      .then((saved) => {
        if (saved.messages?.length) setTurns([greeting, ...saved.messages]);
        if (saved.stage) setFunnel({ stage: saved.stage, data: saved.data ?? {} });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  function restart() {
    const id = crypto.randomUUID();
    try {
      window.localStorage.setItem(SESSION_KEY, id);
    } catch {
      // Private mode: the new id lives for this page only.
    }
    setSessionId(id);
    setTurns([greeting]);
    setFunnel({ stage: "greeting", data: {} });
  }

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setError("");
    // The greeting is UI only; the model sees the real conversation.
    const history = turns.slice(1).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: message }]);
    setBusy(true);
    try {
      const response = variant === "b"
        ? await fetch("/api/sales/b", {
            method: "POST",
            headers: { "content-type": "application/json", "x-session-id": sessionId },
            body: JSON.stringify({ message }),
          })
        : await fetch("/api/sales/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message, history }),
          });
      const data = (await response.json()) as {
        reply?: string;
        products?: Card[];
        leadSaved?: boolean;
        error?: string;
        model?: string;
        diagnostic?: string;
        stage?: string;
        data?: Record<string, string>;
      };
      if (data.stage) setFunnel({ stage: data.stage, data: data.data ?? {} });
      if (!response.ok || !data.reply) throw new Error(data.error || "Не удалось получить ответ.");
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: data.reply as string,
          products: data.products ?? [],
          note: data.leadSaved ? "Контакт передан менеджеру" : undefined,
          model: data.model || `без модели (запасной ответ)${data.diagnostic ? `: ${data.diagnostic}` : ""}`,
        },
      ]);
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setInput(message);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const known = funnel ? Object.entries(funnel.data).filter(([, v]) => v) : [];

  return (
    <section className={styles.chat} aria-label="Чат с консультантом">
      {variant === "b" && (
        <div className={styles.funnel}>
          <span>Этап: <b>{STAGE_LABELS[funnel?.stage ?? "greeting"] ?? funnel?.stage}</b></span>
          {known.map(([k, v]) => (
            <span key={k}>{DATA_LABELS[k] ?? k}: {v}</span>
          ))}
          <button type="button" onClick={restart}>Новый диалог</button>
        </div>
      )}
      <div ref={log} className={styles.log} role="log" aria-live="polite">
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? styles.me : styles.them}>
            <p className={styles.bubble}>{turn.content}</p>
            {turn.products && turn.products.length > 0 && (
              <div className={styles.cards}>
                {turn.products.map((p) => {
                  const inner = (
                    <>
                      {p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <div className={styles.noPhoto}>{p.name.slice(0, 1)}</div>}
                      <strong>{p.name}</strong>
                      {p.price && <span className={styles.price}>{priceLabel(p.price, currency)}</span>}
                      {p.stock && <span className={styles.stock}>{p.stock}</span>}
                    </>
                  );
                  return p.link ? (
                    <a key={p.id} className={styles.card} href={p.link} target="_blank" rel="noopener noreferrer">{inner}</a>
                  ) : (
                    <div key={p.id} className={styles.card}>{inner}</div>
                  );
                })}
              </div>
            )}
            {turn.note && <span className={styles.note}>✓ {turn.note}</span>}
            {turn.model && <span className={styles.model}>{modelLabel(turn.model)}</span>}
          </div>
        ))}
        {busy && (
          <div className={styles.them}>
            <p className={`${styles.bubble} ${styles.typing}`} aria-label="Консультант печатает"><i /><i /><i /></p>
          </div>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <form className={styles.composer} onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={count ? "Напишите, что вас интересует…" : "Напишите вопрос…"}
          maxLength={1000}
          aria-label="Сообщение"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="Отправить"><ArrowUp size={18} /></button>
      </form>
    </section>
  );
}
