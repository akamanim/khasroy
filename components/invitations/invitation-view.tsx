"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackgroundMusic, type MusicControl } from "./music";
import styles from "./invitation.module.css";
import {
  Balloons,
  Clouds,
  Confetti,
  Cord,
  DecoCorners,
  DecoDivider,
  Footprints,
  HornBand,
  HornCorners,
  HornDivider,
  MoonConstellation,
  Mountains,
  NeonHorizon,
  PeonyCluster,
  Postmark,
  Rings,
  ShyrdakBorder,
  ShyrdakMedallion,
  Stamp,
  StarField,
  Sunburst,
  Tunduk,
} from "./decor";
import {
  EVENT_LABELS,
  TEMPLATE_META,
  displayTitle,
  fontsHref,
  type Invitation,
  type Lang,
  type TemplateId,
} from "@/lib/invitations/schema";

const UI: Record<Lang, Record<string, string>> = {
  ru: {
    program: "Программа", place: "Место", map: "Открыть карту", calendar: "Добавить в календарь",
    dress: "Дресс-код", contacts: "Контакты", left: "До события осталось",
    days: "дней", hours: "часов", minutes: "минут", seconds: "секунд", rsvp: "Подтвердить участие",
    rsvpSoon: "Подтверждение откроется после публикации приглашения", deadline: "Просим ответить до",
    wait: "Ждём вас!", photos: "Фото",
    open: "Открыть приглашение", invited: "Вы приглашены", musicOn: "Включить музыку", musicOff: "Выключить музыку",
  },
  ky: {
    program: "Программа", place: "Өтүүчү жер", map: "Картаны ачуу", calendar: "Календарга кошуу",
    dress: "Дресс-код", contacts: "Байланыш", left: "Майрамга чейин калды",
    days: "күн", hours: "саат", minutes: "мүнөт", seconds: "секунд", rsvp: "Катышууну тастыктоо",
    rsvpSoon: "Тастыктоо чакыруу жарыялангандан кийин ачылат", deadline: "Жообуңузду күтөбүз:",
    wait: "Сиздерди күтөбүз!", photos: "Сүрөттөр",
    open: "Чакырууну ачуу", invited: "Сиз чакырылдыңыз", musicOn: "Музыканы күйгүзүү", musicOff: "Музыканы өчүрүү",
  },
  en: {
    program: "Programme", place: "Venue", map: "Open map", calendar: "Add to calendar",
    dress: "Dress code", contacts: "Contacts", left: "Counting down",
    days: "days", hours: "hours", minutes: "minutes", seconds: "seconds", rsvp: "Confirm attendance",
    rsvpSoon: "RSVP opens once the invitation is published", deadline: "Please reply by",
    wait: "We look forward to seeing you!", photos: "Photos",
    open: "Open invitation", invited: "You are invited", musicOn: "Play music", musicOff: "Mute music",
  },
};

const EVENT_LABELS_LANG: Record<Lang, Partial<Record<Invitation["eventType"], string>>> = {
  ru: EVENT_LABELS,
  ky: { wedding: "Үйлөнүү той", birthday: "Туулган күн", gender_party: "Гендер-пати", tushoo_toi: "Тушоо той", kyz_uzatuu: "Кыз узатуу", corporate: "Корпоратив" },
  en: { wedding: "Wedding", birthday: "Birthday", gender_party: "Gender reveal", tushoo_toi: "Tushoo toi", kyz_uzatuu: "Kyz uzatuu", corporate: "Celebration" },
};

const LOCALE: Record<Lang, string> = { ru: "ru-RU", ky: "ky-KG", en: "en-GB" };

const PARTY = ["#ff5d73", "#ffb703", "#3a86ff", "#06d6a0", "#b15eff"];
const REVEAL = ["#f49ac1", "#8ec5ff", "#f49ac1", "#8ec5ff"];

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

function shortDate(inv: Invitation) {
  if (!inv.date) return "";
  const [y, m, d] = inv.date.split("-");
  return `${d}.${m}.${y}`;
}

function initials(inv: Invitation) {
  const letters = inv.hosts.map((h) => h.trim()[0]).filter(Boolean).slice(0, 2);
  if (letters.length) return letters;
  const t = (inv.title || EVENT_LABELS[inv.eventType]).trim()[0];
  return t ? [t] : [];
}

function calendarHref(inv: Invitation, title: string) {
  const start = eventDate(inv);
  if (!start) return "";
  const end = new Date(start.getTime() + 4 * 3_600_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: [inv.venue.name, inv.venue.address].filter(Boolean).join(", "),
    ctz: "Asia/Bishkek",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function Countdown({ target, lang, live }: { target: Date; lang: Lang; live: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  if (now === null) return null;
  const diff = Math.max(0, target.getTime() - now);
  const t = UI[lang];
  const cells: Array<[number, string]> = [
    [Math.floor(diff / 86_400_000), t.days],
    [Math.floor((diff % 86_400_000) / 3_600_000), t.hours],
    [Math.floor((diff % 3_600_000) / 60_000), t.minutes],
    [Math.floor((diff % 60_000) / 1000), t.seconds],
  ];
  return (
    <section className={styles.countdown} aria-label={t.left}>
      <p className={styles.countLabel}>{t.left}</p>
      <div className={styles.countRow}>
        {cells.map(([value, label]) => (
          <div key={label} className={styles.countCell}>
            <strong>{String(value).padStart(2, "0")}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type Decor = {
  backdrop?: ReactNode;
  heroTop?: ReactNode;
  heroBottom?: ReactNode;
  frame?: ReactNode;
  divider: ReactNode;
  monogram?: boolean;
};

function decorFor(id: TemplateId, inv: Invitation): Decor {
  switch (id) {
    case "minimal":
      return { divider: <span className={styles.dot} />, monogram: true };
    case "floral":
      return {
        heroTop: <PeonyCluster className={styles.peonyTop} />,
        heroBottom: <PeonyCluster className={styles.peonyBottom} flip />,
        divider: <PeonyCluster className={styles.peonyDivider} />,
      };
    case "ornament":
      return {
        frame: <HornCorners className={styles.frame} />,
        heroTop: <HornBand className={styles.band} />,
        divider: <HornDivider className={styles.hornDivider} />,
      };
    case "shyrdak":
      return {
        heroTop: <ShyrdakBorder className={styles.feltBorder} />,
        heroBottom: <ShyrdakMedallion className={styles.medallion} />,
        divider: <ShyrdakBorder className={styles.feltBorderThin} />,
      };
    case "tunduk":
      return { heroTop: <Tunduk className={styles.tunduk} />, divider: <Tunduk className={styles.tundukSmall} /> };
    case "celestial":
      return {
        backdrop: <StarField className={styles.stars} />,
        heroTop: <MoonConstellation className={styles.moon} />,
        divider: <span className={styles.sparkle}>✦</span>,
      };
    case "deco":
      return {
        frame: <DecoCorners className={styles.frame} />,
        heroTop: <Sunburst className={styles.sunburst} />,
        divider: <DecoDivider className={styles.decoDivider} />,
        monogram: true,
      };
    case "confetti":
      return {
        backdrop: <Confetti className={styles.confetti} colors={PARTY} />,
        heroTop: <Balloons className={styles.balloons} colors={PARTY} />,
        divider: <span className={styles.squiggle} />,
      };
    case "reveal":
      return {
        backdrop: <Clouds className={styles.clouds} />,
        heroTop: <Balloons className={styles.balloons} colors={REVEAL} />,
        divider: <span className={styles.question}>?</span>,
      };
    case "tianshan":
      return { heroBottom: <Mountains className={styles.mountains} />, divider: <span className={styles.peak} /> };
    case "neon":
      return { backdrop: <NeonHorizon className={styles.horizon} />, divider: <span className={styles.neonLine} /> };
    case "postcard":
      return {
        heroTop: <Stamp className={styles.stamp} label={shortDate(inv) || "2027"} />,
        heroBottom: <Postmark className={styles.postmark} text={`${(inv.venue.address || "Бишкек").slice(0, 24).toUpperCase()} • ${shortDate(inv)} •`} />,
        divider: <span className={styles.airmail} />,
      };
    case "steps":
      return {
        backdrop: <Clouds className={styles.clouds} />,
        heroTop: <Footprints className={styles.footprints} />,
        divider: <Cord className={styles.cord} />,
      };
    default:
      return { divider: <span className={styles.dot} /> };
  }
}

function Title({ inv }: { inv: Invitation }) {
  if (!inv.title && inv.eventType === "wedding" && inv.hosts.length >= 2) {
    return (
      <h1 className={`${styles.title} ${styles.titleStack}`}>
        <span>{inv.hosts[0]}</span>
        <span className={styles.amp} aria-label="и">&amp;</span>
        <span>{inv.hosts[1]}</span>
      </h1>
    );
  }
  return <h1 className={styles.title}>{displayTitle(inv)}</h1>;
}

export function InvitationView({ invitation, live = true }: { invitation: Invitation; live?: boolean }) {
  const languages = invitation.languages.length ? invitation.languages : (["ru"] as Lang[]);
  const [lang, setLang] = useState<Lang>(languages[0]);
  useEffect(() => {
    if (!languages.includes(lang)) setLang(languages[0]);
  }, [languages, lang]);

  const id = TEMPLATE_META[invitation.templateId] ? invitation.templateId : "minimal";
  const meta = TEMPLATE_META[id];
  const t = UI[lang];
  const target = useMemo(() => eventDate(invitation), [invitation]);
  const title = displayTitle(invitation);
  const decor = decorFor(id, invitation);
  const message =
    invitation.message[lang] || invitation.message[languages.find((l) => invitation.message[l]) ?? "ru"] || "";
  const mapHref =
    invitation.venue.mapUrl ||
    (invitation.venue.address || invitation.venue.name
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${invitation.venue.name} ${invitation.venue.address}`.trim())}`
      : "");
  const calHref = calendarHref(invitation, title);
  const mono = initials(invitation);

  const hasMusic = live && Boolean(invitation.musicVideoId);
  const [opened, setOpened] = useState(!hasMusic);
  const music = useRef<MusicControl | null>(null);
  const onMusicControl = useCallback((control: MusicControl) => {
    music.current = control;
  }, []);
  function openInvitation() {
    music.current?.start();
    setOpened(true);
  }

  const classes = [
    styles.root,
    styles[`t_${id}`],
    meta.paletteable ? styles[`p_${invitation.palette}`] : "",
    live ? styles.live : styles.still,
  ].join(" ");

  return (
    <article className={classes} lang={lang}>
      {live ? <link rel="stylesheet" href={fontsHref([id])} precedence="default" /> : null}
      {decor.backdrop ? <div className={styles.backdrop}>{decor.backdrop}</div> : null}
      {decor.frame ? <div className={styles.frameLayer}>{decor.frame}</div> : null}

      {hasMusic ? (
        <BackgroundMusic
          videoId={invitation.musicVideoId}
          start={invitation.musicStart}
          onControl={onMusicControl}
          labels={{ on: t.musicOn, off: t.musicOff }}
        />
      ) : null}
      {hasMusic ? (
        <div className={`${styles.cover} ${opened ? styles.coverOpen : ""}`} aria-hidden={opened}>
          <div className={styles.coverInner}>
            <p className={styles.kicker}>{t.invited}</p>
            <Title inv={invitation} />
            {invitation.date ? <p className={styles.date}><span>{formatDate(invitation, lang)}</span></p> : null}
            <button type="button" className={styles.button} onClick={openInvitation} tabIndex={opened ? -1 : 0}>
              {t.open}
            </button>
          </div>
        </div>
      ) : null}

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
        {decor.heroTop}
        <p className={styles.kicker}>{EVENT_LABELS_LANG[lang][invitation.eventType] ?? EVENT_LABELS[invitation.eventType]}</p>
        {decor.monogram && mono.length ? (
          <div className={styles.monogram} aria-hidden="true">
            <Rings className={styles.rings} />
            <span>{mono.join("")}</span>
          </div>
        ) : null}
        <Title inv={invitation} />
        {invitation.date ? (
          <p className={styles.date}>
            <span>{formatDate(invitation, lang)}</span>
            {invitation.time ? <span className={styles.time}>{invitation.time}</span> : null}
          </p>
        ) : null}
        {decor.heroBottom}
      </header>

      <div className={styles.body}>
        {invitation.photos[0] ? (
          <figure className={styles.photoMain}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={invitation.photos[0]} alt="" loading={live ? "eager" : "lazy"} />
          </figure>
        ) : null}

        {message ? <p className={styles.message}>{message}</p> : null}

        <div className={styles.divider}>{decor.divider}</div>

        {target && target.getTime() > Date.now() - 86_400_000 ? <Countdown target={target} lang={lang} live={live} /> : null}

        {invitation.program.length ? (
          <section className={styles.section}>
            <h2>{t.program}</h2>
            <ol className={styles.timeline}>
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
          <section className={`${styles.section} ${styles.venue}`}>
            <h2>{t.place}</h2>
            {invitation.venue.name ? <p className={styles.venueName}>{invitation.venue.name}</p> : null}
            {invitation.venue.address ? <p className={styles.muted}>{invitation.venue.address}</p> : null}
            <div className={styles.actions}>
              {mapHref ? (
                <a className={styles.button} href={mapHref} target="_blank" rel="noopener noreferrer">{t.map}</a>
              ) : null}
              {calHref ? (
                <a className={`${styles.button} ${styles.buttonGhost}`} href={calHref} target="_blank" rel="noopener noreferrer">{t.calendar}</a>
              ) : null}
            </div>
          </section>
        ) : null}

        {invitation.photos.length > 1 ? (
          <section className={styles.section}>
            <h2>{t.photos}</h2>
            <div className={styles.gallery}>
              {invitation.photos.slice(1).map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          </section>
        ) : null}

        {invitation.dressCode ? (
          <section className={styles.section}>
            <h2>{t.dress}</h2>
            <p className={styles.muted}>{invitation.dressCode}</p>
          </section>
        ) : null}

        {invitation.rsvpEnabled ? (
          <section className={`${styles.section} ${styles.rsvp}`}>
            <h2>{t.rsvp}</h2>
            {invitation.rsvpDeadline ? (
              <p className={styles.muted}>
                {t.deadline}{" "}
                {new Date(`${invitation.rsvpDeadline}T12:00:00+06:00`).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", timeZone: "Asia/Bishkek" })}
              </p>
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
      </div>

      <footer className={styles.footer}>
        <div className={styles.divider}>{decor.divider}</div>
        <p className={styles.wait}>{t.wait}</p>
        {mono.length ? <p className={styles.footMono}>{mono.join(" & ")}</p> : null}
        {invitation.date ? <p className={styles.footDate}>{shortDate(invitation)}</p> : null}
      </footer>
    </article>
  );
}
