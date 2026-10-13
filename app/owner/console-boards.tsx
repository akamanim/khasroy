"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { FEATURES, FEATURE_STATUS, type FeatureStatus } from "@/lib/owner-features";
import type { OwnerDashboard, ProviderStatus } from "@/lib/owner-dashboard";
import { CloudBrowser } from "./cloud-browser";
import styles from "./console.module.css";

/** Loads /api/owner/dashboard and refreshes it every minute. */
export function useOwnerDashboard() {
  const [data, setData] = useState<OwnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/owner/dashboard", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          setUnauthorized(true);
          return;
        }
        if (!response.ok) return;
        setUnauthorized(false);
        setData((await response.json()) as OwnerDashboard);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { data, loading, unauthorized, refresh };
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const diff = now - prev;
  if (!diff) return <span className={styles.flat}>= к прошлой неделе</span>;
  return (
    <span className={diff > 0 ? styles.up : styles.down}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} к прошлой неделе
    </span>
  );
}

function Kpi({ label, value, now, prev, hint }: { label: string; value: string | number; now?: number; prev?: number; hint?: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiRow}>
        <span>{label}</span>
        <b>{value}</b>
      </div>
      {typeof now === "number" && typeof prev === "number" ? <Delta now={now} prev={prev} /> : null}
      {hint ? <span className={styles.flat}>{hint}</span> : null}
    </div>
  );
}

function Gate({ loading, unauthorized, onLogin }: { loading: boolean; unauthorized: boolean; onLogin: () => void }) {
  if (unauthorized) {
    return (
      <div className={styles.panel}>
        <p className={styles.muted}>Цифры видны только владельцу.</p>
        <button type="button" className={styles.pillButton} onClick={onLogin}>Войти</button>
      </div>
    );
  }
  return <div className={styles.panel}><p className={styles.muted}>{loading ? "Загружаю цифры…" : "Цифры не загрузились."}</p></div>;
}

export function LeftBoard({
  data,
  loading,
  unauthorized,
  onLogin,
}: {
  data: OwnerDashboard | null;
  loading: boolean;
  unauthorized: boolean;
  onLogin: () => void;
}) {
  if (!data) return <Gate loading={loading} unauthorized={unauthorized} onLogin={onLogin} />;
  const inv = data.stats?.invitations;
  const sales = data.stats?.sales;
  const ordered = inv ? inv.orders7 : 0;
  return (
    <div className={styles.board}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Приглашения</span>
          <span className={inv ? styles.ok : styles.bad}>{inv ? "● работает" : "● нет данных"}</span>
        </header>
        {inv ? (
          <>
            <Kpi label="Заказы за 7 дней" value={ordered} now={inv.orders7} prev={inv.ordersPrev} />
            <Kpi label="Начали, но не заказали" value={inv.started7} now={inv.started7} prev={inv.startedPrev} />
            <Kpi label="Ответы гостей" value={inv.rsvp7} now={inv.rsvp7} prev={inv.rsvpPrev} />
            <a className={styles.link} href="/owner/orders">Заказы ›</a>
          </>
        ) : (
          <p className={styles.muted}>{data.statsError ?? "Статистика не загрузилась."}</p>
        )}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Продажник · Graviti</span>
          <span className={sales ? styles.ok : styles.bad}>{sales ? "● работает" : "● нет данных"}</span>
        </header>
        {sales ? (
          <>
            <Kpi label="Заявки за 7 дней" value={sales.leads7} now={sales.leads7} prev={sales.leadsPrev} />
            <Kpi label="Диалоги (вариант Б)" value={sales.chats7} now={sales.chats7} prev={sales.chatsPrev} />
            <div className={styles.linkRow}>
              <a className={styles.link} href="/sales/leads">Заявки ›</a>
              <a className={styles.link} href="/sales" target="_blank" rel="noopener noreferrer">Открыть ›</a>
            </div>
          </>
        ) : null}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Khasroy studia</span>
          <span className={styles.ok}>● новое</span>
        </header>
        <p className={styles.muted}>Задача → сценарий → ваше «да» → видео.</p>
        <a className={styles.link} href="/owner/reels">Открыть ›</a>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Khasroy Trading</span>
          <span className={styles.ok}>● новое</span>
        </header>
        <p className={styles.muted}>Живой график Binance, анализ, журнал сигналов и бумажный кошелёк $200.</p>
        <div className={styles.linkRow}>
          <a className={styles.link} href="/trading" target="_blank" rel="noopener noreferrer">Открыть ›</a>
          <a className={styles.link} href="https://t.me/Khasroy_bot" target="_blank" rel="noopener noreferrer">Telegram ›</a>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.soon}`}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Лендинги</span>
          <span className={styles.muted}>скоро</span>
        </header>
        <p className={styles.muted}>Новый инструмент появится здесь со своими цифрами.</p>
      </section>
    </div>
  );
}

const STATE_CLASS: Record<ProviderStatus["state"], string> = {
  ok: "ok",
  limited: "warn",
  error: "bad",
  missing: "muted",
  unchecked: "muted",
};


export function RightBoard({
  data,
  loading,
  unauthorized,
  coreState,
  onLogin,
}: {
  data: OwnerDashboard | null;
  loading: boolean;
  unauthorized: boolean;
  coreState: string;
  onLogin: () => void;
}) {
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const stateLabel = coreState === "thinking" ? "думает" : coreState === "responding" ? "отвечает" : coreState === "listening" ? "слушает" : "в покое";
  return (
    <div className={styles.board}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Хасрой</span>
          <span className={coreState === "idle" ? styles.muted : styles.accent}>{stateLabel}</span>
        </header>
        <button type="button" className={styles.featuresButton} onClick={() => setFeaturesOpen(true)}>
          <Sparkles size={14} /> Все функции Хасроя
        </button>
        {data ? (
          <div className={styles.list}>
            <div className={styles.listRow}><span>Модель</span><b>{data.model.replace(/^openai\//u, "")}</b></div>
            {data.providers.map((p) => (
              <div key={p.id} className={styles.listRow}>
                <span><i className={`${styles.dot} ${styles[STATE_CLASS[p.state]]}`} />{p.name}</span>
                <b className={styles[STATE_CLASS[p.state]]}>{p.detail}</b>
              </div>
            ))}
            <div className={styles.listRow}><span>Навыки</span><b>{data.skills.verified} проверено{data.skills.learning ? ` · ${data.skills.learning} учит` : ""}</b></div>
            <span className={styles.flat}>
              проверено в {new Date(data.checkedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" })}
            </span>
          </div>
        ) : (
          <Gate loading={loading} unauthorized={unauthorized} onLogin={onLogin} />
        )}
      </section>

      <CloudBrowser unauthorized={unauthorized} onLogin={onLogin} />
      {featuresOpen ? <FeaturesDialog skills={data?.skillList ?? null} onClose={() => setFeaturesOpen(false)} /> : null}
    </div>
  );
}

const STATUS_CLASS: Record<FeatureStatus, string> = { verified: "ok", built: "accent", setup: "warn" };

function FeaturesDialog({
  skills,
  onClose,
}: {
  skills: OwnerDashboard["skillList"] | null;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const total = FEATURES.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Все функции Хасроя" className={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.dialogHead}>
          <div>
            <h2>Что умеет Хасрой</h2>
            <p className={styles.muted}>
              {total} функций. <span className={styles.ok}>проверено</span> — работает на сайте и проверено;{" "}
              <span className={styles.accent}>есть</span> — сделано, давно не перепроверялось;{" "}
              <span className={styles.warn}>нужна настройка</span> — нужны ключи в настройках.
            </p>
          </div>
          <button ref={closeButton} type="button" className={styles.iconButton} onClick={onClose} aria-label="Закрыть">
            <X size={15} />
          </button>
        </header>
        <div className={styles.dialogBody}>
          {FEATURES.map((group) => (
            <section key={group.title} className={styles.featureGroup}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((f) => (
                  <li key={f.name}>
                    <div className={styles.featureTop}>
                      {f.href ? <a href={f.href}>{f.name}</a> : <b>{f.name}</b>}
                      <span className={styles[STATUS_CLASS[f.status]]}>{FEATURE_STATUS[f.status]}</span>
                    </div>
                    <p>{f.what}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className={styles.featureGroup}>
            <h3>Навыки из памяти</h3>
            {skills === null ? (
              <p className={styles.muted}>Список навыков виден владельцу после входа.</p>
            ) : skills.length ? (
              <ul>
                {skills.map((skill) => (
                  <li key={skill.name}>
                    <div className={styles.featureTop}>
                      <b>{skill.name}</b>
                      <span className={skill.status === "verified" ? styles.ok : styles.muted}>{skill.status === "verified" ? "проверен" : "учит"}</span>
                    </div>
                    {skill.description ? <p>{skill.description}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Навыков в памяти пока нет.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
