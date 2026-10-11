"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import styles from "./sales.module.css";

type Card = { id: string; name: string; price: string; photo: string; link: string; stock: string };
type Turn = { role: "user" | "assistant"; content: string; products?: Card[]; note?: string };

function priceLabel(price: string, currency: string) {
  if (!price) return "";
  return /^\d[\d\s.,]*$/u.test(price) && currency ? `${price.replace(/\B(?=(\d{3})+(?!\d))/gu, " ")} ${currency}` : price;
}

export function SalesChat({ shop, currency, count }: { shop: string; currency: string; count: number }) {
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: "assistant",
      content: `Здравствуйте! Я консультант «${shop}». Подскажу по товарам, ценам, наличию и доставке. Что ищете?`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);

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
      const response = await fetch("/api/sales/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = (await response.json()) as { reply?: string; products?: Card[]; leadSaved?: boolean; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error || "Не удалось получить ответ.");
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: data.reply as string,
          products: data.products ?? [],
          note: data.leadSaved ? "Контакт передан менеджеру" : undefined,
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

  return (
    <section className={styles.chat} aria-label="Чат с консультантом">
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
