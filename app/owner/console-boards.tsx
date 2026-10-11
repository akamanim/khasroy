"use client";

import { useCallback, useEffect, useState } from "react";
import type { OwnerDashboard, ProviderStatus } from "@/lib/owner-dashboard";
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
  const conversion = inv && inv.orders7 + inv.started7 > 0 ? `${Math.round((inv.orders7 / (inv.orders7 + inv.started7)) * 100)}%` : "—";
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
            <Kpi label="Доходят до заказа" value={conversion} hint="из тех, кто начал за 7 дней" />
            <Kpi label="Зашли на сайт" value="—" hint="визиты пока не считаются" />
            <Kpi label="Ответы гостей" value={inv.rsvp7} now={inv.rsvp7} prev={inv.rsvpPrev} />
            <Kpi label="Живых приглашений" value={inv.live} />
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

const TASK_STATUS: Record<string, string> = {
  waiting_for_compute: "ждёт ресурсов",
  queued: "в очереди",
  running: "в работе",
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
  const stateLabel = coreState === "thinking" ? "думает" : coreState === "responding" ? "отвечает" : coreState === "listening" ? "слушает" : "в покое";
  return (
    <div className={styles.board}>
      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Хасрой</span>
          <span className={coreState === "idle" ? styles.muted : styles.accent}>{stateLabel}</span>
        </header>
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

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Задачи</span>
          <span className={styles.muted}>{data ? `${data.tasks.length} в очереди` : ""}</span>
        </header>
        {data && data.tasks.length ? (
          <div className={styles.list}>
            {data.tasks.map((t) => (
              <div key={t.id} className={styles.listRow}>
                <span><i className={`${styles.dot} ${styles.accent}`} />{t.kind.replace(/_/gu, " ")}</span>
                <b className={styles.muted}>{TASK_STATUS[t.status] ?? t.status}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.muted}>Фоновых задач сейчас нет.</p>
        )}
      </section>

      <section className={`${styles.panel} ${styles.soon} ${styles.browser}`}>
        <header className={styles.panelHead}>
          <span className={styles.label}>Облачный браузер</span>
          <span className={styles.muted}>следующий шаг</span>
        </header>
        <div className={styles.browserBar}><i /><i /><i /><span>адрес сайта</span></div>
        <div className={styles.browserView}>
          <p>Здесь будет видно, как Хасрой открывает сайты и выполняет задачи: «посмотри kelshi.kz и выпиши цены».</p>
        </div>
      </section>
    </div>
  );
}
