"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, ExternalLink } from "lucide-react";
import { Core, type CoreState } from "@/components/khasroy/core";
import { InvitationView } from "@/components/invitations/invitation-view";
import {
  EVENT_LABELS,
  EVENT_TYPES,
  TEMPLATE_IDS,
  TEMPLATE_LABELS,
  sampleInvitation,
  type EventType,
  type Invitation,
  type TemplateId,
} from "@/lib/invitations/schema";
import styles from "./studio-home.module.css";

type Turn = { role: "user" | "assistant"; content: string };
type StudioState = {
  slug: string | null;
  status: string | null;
  invitation: Invitation | null;
  history: Turn[];
  missing: string[];
};

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Forum&family=Manrope:wght@400;500;600&family=Marck+Script&display=swap";

const GREETING =
  "Здравствуйте! Я Хасрой. Создам для вас онлайн-приглашение, которое можно отправить гостям ссылкой. Какое событие готовите?";

function Phone({ invitation }: { invitation: Invitation }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 390);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={styles.phone}>
      <div className={styles.phoneInner} style={{ transform: `scale(${scale})` }}>
        <InvitationView invitation={invitation} live={false} />
      </div>
    </div>
  );
}

async function resizeToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = url;
    });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Home() {
  const [state, setState] = useState<StudioState>({ slug: null, status: null, invitation: null, history: [], missing: [] });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [contact, setContact] = useState({ name: "", phone: "" });
  const thread = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/invite/session")
      .then((r) => r.json())
      .then((data: StudioState) => setState((s) => ({ ...s, ...data, history: data.history ?? [] })))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [state.history.length, busy]);

  const coreState: CoreState = responding ? "responding" : busy ? "thinking" : focused ? "listening" : "idle";
  const eventType: EventType = state.invitation?.eventType ?? "wedding";
  const submitted = Boolean(state.status && state.status !== "draft");

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Что-то пошло не так. Попробуйте ещё раз.");
    return data as StudioState & { reply?: string };
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError("");
    setInput("");
    setBusy(true);
    setState((s) => ({ ...s, history: [...s.history, { role: "user", content: message }] }));
    try {
      const data = await post("/api/invite/chat", { message });
      setResponding(true);
      setState({ slug: data.slug, status: data.status, invitation: data.invitation, history: data.history, missing: data.missing });
      window.setTimeout(() => setResponding(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState((s) => ({ ...s, history: s.history.slice(0, -1) }));
      setInput(message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseTemplate(templateId: TemplateId) {
    if (submitted) return;
    try {
      const data = await post("/api/invite/template", { templateId });
      setState((s) => ({ ...s, ...data, history: data.history ?? s.history }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function uploadPhoto(file: File) {
    setError("");
    setBusy(true);
    try {
      const base64 = await resizeToJpeg(file);
      const data = await post("/api/invite/photo", { contentType: "image/jpeg", base64 });
      setState((s) => ({ ...s, ...data, history: data.history ?? s.history }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить фото.");
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const data = await post("/api/invite/submit", contact);
      setState((s) => ({ ...s, ...data, history: data.history ?? s.history }));
      setOrdering(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const turns: Turn[] = [{ role: "assistant", content: GREETING }, ...state.history];

  return (
    <div className={styles.shell}>
      <link rel="stylesheet" href={FONT_HREF} precedence="default" />
      <main className={styles.main}>
        <div className={styles.cloud}>
          <Core state={coreState} />
        </div>

        <div ref={thread} className={styles.thread} aria-live="polite">
          {turns.map((turn, i) => (
            <p key={i} className={turn.role === "user" ? styles.user : styles.assistant}>{turn.content}</p>
          ))}
          {!state.history.length ? (
            <div className={styles.chips}>
              {EVENT_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => send(EVENT_LABELS[type])}>{EVENT_LABELS[type]}</button>
              ))}
            </div>
          ) : null}
          {busy ? <p className={`${styles.assistant} ${styles.typing}`}><span /><span /><span /></p> : null}
          {submitted ? (
            <p className={styles.assistant}>Спасибо! Заказ принят. Мы проверим приглашение и свяжемся с вами по указанному номеру.</p>
          ) : null}
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Добавить фото"
            disabled={busy || submitted}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadPhoto(file);
            }}
          />
          <textarea
            value={input}
            rows={1}
            placeholder={submitted ? "Заказ оформлен" : "Напишите Хасрою…"}
            disabled={submitted}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <button type="submit" className={styles.sendButton} aria-label="Отправить" disabled={busy || !input.trim() || submitted}>
            <ArrowUp size={18} />
          </button>
        </form>
      </main>

      <aside className={styles.gallery} aria-label="Шаблоны">
        {state.invitation && state.slug ? (
          <section className={styles.current}>
            <Phone invitation={state.invitation} />
            <div className={styles.currentActions}>
              <a href={`/i/${state.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} /> Открыть
              </a>
              {!submitted ? (
                <button type="button" disabled={state.missing.length > 0} onClick={() => setOrdering((v) => !v)}>
                  Оформить заказ
                </button>
              ) : null}
            </div>
            {!submitted && state.missing.length ? (
              <p className={styles.hint}>Осталось: {state.missing.join(", ")}</p>
            ) : null}
            {ordering && !submitted ? (
              <form className={styles.order} onSubmit={submitOrder}>
                <input placeholder="Ваше имя" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                <input placeholder="+996 700 123 456" inputMode="tel" required value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                <button type="submit">Отправить заказ</button>
              </form>
            ) : null}
          </section>
        ) : null}

        <div className={styles.templates}>
          {TEMPLATE_IDS.map((id) => {
            const active = state.invitation?.templateId === id;
            return (
              <button
                key={id}
                type="button"
                className={`${styles.template} ${active ? styles.templateOn : ""}`}
                onClick={() => chooseTemplate(id)}
                aria-pressed={active}
                title={TEMPLATE_LABELS[id].note}
              >
                <Phone invitation={sampleInvitation(id, eventType)} />
                <span>{TEMPLATE_LABELS[id].name}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
