"use client";

import { useEffect, useId, useMemo, useState } from "react";
import styles from "./invitation.module.css";
import { EVENT_LABELS, displayTitle, type Invitation, type Lang } from "@/lib/invitations/schema";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Forum&family=Manrope:wght@400;500;600&family=Marck+Script&display=swap";

const UI: Record<Lang, Record<string, string>> = {
  ru: {
    program: "Программа", place: "Место", map: "Открыть карту", dress: "Дресс-код", contacts: "Контакты",
    left: "До события", days: "дней", hours: "часов", minutes: "минут", rsvp: "Подтвердить участие",
    rsvpSoon: "Подтверждение откроется после публикации приглашения", deadline: "Просим ответить до",
  },
  ky: {
    program: "Программа", place: "Өтүүчү жер", map: "Картаны ачуу", dress: "Дресс-код", contacts: "Байланыш",
    left: "Калды", days: "күн", hours: "саат", minutes: "мүнөт", rsvp: "Катышууну тастыктоо",
    rsvpSoon: "Тастыктоо чакыруу жарыялангандан кийин ачылат", deadline: "Жообуңузду күтөбүз:",
  },
  en: {
    program: "Programme", place: "Venue", map: "Open map", dress: "Dress code", contacts: "Contacts",
    left: "Time left", days: "days", hours: "hours", minutes: "minutes", rsvp: "Confirm attendance",
    rsvpSoon: "RSVP opens once the invitation is published", deadline: "Please reply by",
  },
};

const EVENT_LABELS_LANG: Record<Lang, Partial<Record<Invitation["eventType"], string>>> = {
  ru: EVENT_LABELS,
  ky: { wedding: "Үйлөнүү той", birthday: "Туулган күн", gender_party: "Гендер-пати", tushoo_toi: "Тушоо той", kyz_uzatuu: "Кыз узатуу", corporate: "Корпоратив" },
  en: { wedding: "Wedding", birthday: "Birthday", gender_party: "Gender reveal", tushoo_toi: "Tushoo toi", kyz_uzatuu: "Kyz uzatuu", corporate: "Corporate party" },
};

const LOCALE: Record<Lang, string> = { ru: "ru-RU", ky: "ky-KG", en: "en-GB" };

function eventDate(inv: Invitation): Date | null {
  if (!inv.date) return null;
  const d = new Date(`${inv.date}T${inv.time || "12:00"}:00+06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(inv: Invitation, lang: Lang) {
  const d = eventDate(inv);
  if (!d) return "";
  try {
    return d.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Asia/Bishkek" });
  } catch {
    return inv.date;
  }
}

function Countdown({ target, lang, live }: { target: Date; lang: Lang; live: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [live]);
  if (now === null) return null;
  const diff = Math.max(0, target.getTime() - now);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const t = UI[lang];
  return (
    <div className={styles.countdown} aria-label={t.left}>
      <span className={styles.kicker}>{t.left}</span>
      <div className={styles.countRow}>
        {[[days, t.days], [hours, t.hours], [minutes, t.minutes]].map(([value, label]) => (
          <div key={String(label)} className={styles.countCell}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloralBranch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 120" aria-hidden="true">
      <path d="M6 112 C 60 96, 110 70, 194 8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {[[40, 98, -30], [70, 86, -40], [100, 70, -35], [128, 52, -45], [156, 34, -40], [180, 18, -50]].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}>
          <ellipse cx="0" cy="-11" rx="5.5" ry="12" fill="currentColor" opacity=".22" />
          <ellipse cx="0" cy="11" rx="5" ry="10" fill="currentColor" opacity=".16" transform="rotate(70)" />
        </g>
      ))}
      <circle cx="194" cy="8" r="5" fill="currentColor" opacity=".45" />
      <circle cx="120" cy="58" r="3.5" fill="currentColor" opacity=".4" />
    </svg>
  );
}

function OrnamentBand({ className }: { className?: string }) {
  const id = `kh-orn-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  return (
    <svg className={className} viewBox="0 0 240 36" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={id} width="40" height="36" patternUnits="userSpaceOnUse">
          <path d="M20 4 L34 18 L20 32 L6 18 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M20 11 L27 18 L20 25 L13 18 Z" fill="currentColor" opacity=".55" />
          <path d="M0 18 C 3 12, 6 12, 6 18 M40 18 C 37 12, 34 12, 34 18" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M20 4 C 16 0, 12 1, 13 5 M20 4 C 24 0, 28 1, 27 5 M20 32 C 16 36, 12 35, 13 31 M20 32 C 24 36, 28 35, 27 31" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="240" height="36" fill={`url(#${id})`} />
    </svg>
  );
}

export function InvitationView({ invitation, live = true }: { invitation: Invitation; live?: boolean }) {
  const languages = invitation.languages.length ? invitation.languages : (["ru"] as Lang[]);
  const [lang, setLang] = useState<Lang>(languages[0]);
  useEffect(() => {
    if (!languages.includes(lang)) setLang(languages[0]);
  }, [languages, lang]);

  const t = UI[lang];
  const target = useMemo(() => eventDate(invitation), [invitation]);
  const title = displayTitle(invitation);
  const message = invitation.message[lang] || invitation.message[languages.find((l) => invitation.message[l]) ?? "ru"] || "";
  const mapHref = invitation.venue.mapUrl ||
    (invitation.venue.address || invitation.venue.name
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${invitation.venue.name} ${invitation.venue.address}`.trim())}`
      : "");
  const template = invitation.templateId;

  return (
    <article className={`${styles.root} ${styles[template]} ${styles[`p_${invitation.palette}`]}`} lang={lang}>
      {live ? <link rel="stylesheet" href={FONT_HREF} precedence="default" /> : null}
      {languages.length > 1 ? (
        <nav className={styles.langs} aria-label="Language">
          {languages.map((l) => (
            <button key={l} type="button" className={l === lang ? styles.langOn : ""} onClick={() => setLang(l)}>
              {l === "ru" ? "Рус" : l === "ky" ? "Кыр" : "Eng"}
            </button>
          ))}
        </nav>
      ) : null}

      <header className={styles.hero}>
        {template === "floral" ? <FloralBranch className={styles.branchTop} /> : null}
        {template === "ornament" ? <OrnamentBand className={styles.band} /> : null}
        <span className={styles.kicker}>{EVENT_LABELS_LANG[lang][invitation.eventType] ?? EVENT_LABELS[invitation.eventType]}</span>
        <h1 className={styles.title}>{title}</h1>
        {invitation.date ? (
          <p className={styles.date}>
            {formatDate(invitation, lang)}
            {invitation.time ? <span> · {invitation.time}</span> : null}
          </p>
        ) : null}
        {template === "minimal" ? <span className={styles.rule} aria-hidden="true" /> : null}
        {template === "floral" ? <FloralBranch className={styles.branchBottom} /> : null}
      </header>

      {invitation.photos[0] ? (
        <div className={styles.photoMain}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={invitation.photos[0]} alt="" loading={live ? "eager" : "lazy"} />
        </div>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}

      {target && target.getTime() > Date.now() - 86_400_000 ? <Countdown target={target} lang={lang} live={live} /> : null}

      {invitation.program.length ? (
        <section className={styles.section}>
          <h2>{t.program}</h2>
          <ol className={styles.program}>
            {invitation.program.map((item, i) => (
              <li key={i}>
                <time>{item.time}</time>
                <span>{item.title}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {invitation.venue.name || invitation.venue.address ? (
        <section className={styles.section}>
          <h2>{t.place}</h2>
          {invitation.venue.name ? <p className={styles.venueName}>{invitation.venue.name}</p> : null}
          {invitation.venue.address ? <p className={styles.muted}>{invitation.venue.address}</p> : null}
          {mapHref ? (
            <a className={styles.button} href={mapHref} target="_blank" rel="noopener noreferrer">{t.map}</a>
          ) : null}
        </section>
      ) : null}

      {invitation.photos.length > 1 ? (
        <section className={styles.gallery}>
          {invitation.photos.slice(1).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading="lazy" />
          ))}
        </section>
      ) : null}

      {invitation.dressCode ? (
        <section className={styles.section}>
          <h2>{t.dress}</h2>
          <p className={styles.muted}>{invitation.dressCode}</p>
        </section>
      ) : null}

      {invitation.rsvpEnabled ? (
        <section className={styles.section}>
          <h2>{t.rsvp}</h2>
          {invitation.rsvpDeadline ? (
            <p className={styles.muted}>{t.deadline} {new Date(`${invitation.rsvpDeadline}T12:00:00+06:00`).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", timeZone: "Asia/Bishkek" })}</p>
          ) : null}
          <p className={styles.note}>{t.rsvpSoon}</p>
        </section>
      ) : null}

      {invitation.contacts.length ? (
        <section className={styles.section}>
          <h2>{t.contacts}</h2>
          <ul className={styles.contacts}>
            {invitation.contacts.map((c) => (
              <li key={c.phone}>
                <span>{c.name}</span>
                <a href={`tel:${c.phone.replace(/[^\d+]/gu, "")}`}>{c.phone}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {template === "ornament" ? <OrnamentBand className={styles.band} /> : null}
    </article>
  );
}
