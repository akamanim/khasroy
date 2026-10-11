"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  Particles,
  NeonHorizon,
  PeonyCluster,
  Postmark,
  Rings,
  ShyrdakBorder,
  ShyrdakMedallion,
  Stamp,
  SteppeSunset,
  ScallopCap,
  GoldHeart,
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
    hosts: "Хозяева торжества", calendar_title: "Сохраните дату",
    rsvpAsk: "Пожалуйста, подтвердите ваше присутствие", yourName: "Ваше имя", ansYes: "Приду", ansFamily: "Приду с семьёй", ansNo: "К сожалению, не смогу прийти", send: "Отправить ответ", sending: "Отправляем…", thanks: "Спасибо! Ваш ответ получен.", nameErr: "Напишите ваше имя", choiceErr: "Выберите вариант ответа", sendErr: "Не удалось отправить. Попробуйте ещё раз.", previewNote: "Форма заработает в опубликованном приглашении",
    open: "Открыть приглашение", invited: "Вы приглашены", musicOn: "Включить музыку", musicOff: "Выключить музыку",
  },
  ky: {
    program: "Программа", place: "Өтүүчү жер", map: "Картаны ачуу", calendar: "Календарга кошуу",
    dress: "Дресс-код", contacts: "Байланыш", left: "Майрамга чейин калды",
    days: "күн", hours: "саат", minutes: "мүнөт", seconds: "секунд", rsvp: "Катышууну тастыктоо",
    rsvpSoon: "Тастыктоо чакыруу жарыялангандан кийин ачылат", deadline: "Жообуңузду күтөбүз:",
    wait: "Сиздерди күтөбүз!", photos: "Сүрөттөр",
    hosts: "Той ээлери", calendar_title: "Датаны белгилеп алыңыз",
    rsvpAsk: "Сураныч, келериңизди тастыктаңыз", yourName: "Атыңыз", ansYes: "Барам", ansFamily: "Үй-бүлөм менен барам", ansNo: "Тилекке каршы, бара албайм", send: "Жоопту жөнөтүү", sending: "Жөнөтүлүүдө…", thanks: "Рахмат! Жообуңуз кабыл алынды.", nameErr: "Атыңызды жазыңыз", choiceErr: "Жооп вариантын тандаңыз", sendErr: "Жөнөтүлгөн жок. Кайра аракет кылыңыз.", previewNote: "Форма жарыяланган чакырууда иштейт",
    open: "Чакырууну ачуу", invited: "Сиз чакырылдыңыз", musicOn: "Музыканы күйгүзүү", musicOff: "Музыканы өчүрүү",
  },
  en: {
    program: "Programme", place: "Venue", map: "Open map", calendar: "Add to calendar",
    dress: "Dress code", contacts: "Contacts", left: "Counting down",
    days: "days", hours: "hours", minutes: "minutes", seconds: "seconds", rsvp: "Confirm attendance",
    rsvpSoon: "RSVP opens once the invitation is published", deadline: "Please reply by",
    wait: "We look forward to seeing you!", photos: "Photos",
    hosts: "Hosted by", calendar_title: "Save the date",
    rsvpAsk: "Please confirm your attendance", yourName: "Your name", ansYes: "I will come", ansFamily: "Coming with family", ansNo: "Sorry, I can't make it", send: "Send answer", sending: "Sending…", thanks: "Thank you! Your answer has been received.", nameErr: "Enter your name", choiceErr: "Choose an answer", sendErr: "Could not send. Please try again.", previewNote: "The form works in the published invitation",
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

const WEEKDAYS: Record<Lang, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ky: ["Дш", "Шш", "Шр", "Бш", "Жм", "Иш", "Жк"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
};
const MONTHS: Record<Lang, string[]> = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  ky: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

function MonthCalendar({ date, lang, title }: { date: string; lang: Lang; title: string }) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <section className={`${styles.section} ${styles.calendar}`} data-reveal="">
      <h2>{title}</h2>
      <p className={styles.calMonth}>{MONTHS[lang][m - 1]} {y}</p>
      <div className={styles.calGrid} role="grid">
        {WEEKDAYS[lang].map((w) => (
          <span key={w} className={styles.calHead}>{w}</span>
        ))}
        {cells.map((n, i) =>
          n === null ? <span key={`e${i}`} /> : (
            <span key={n} className={n === d ? styles.calDay : undefined} aria-current={n === d ? "date" : undefined}>
              {n}
            </span>
          ),
        )}
      </div>
    </section>
  );
}

function Countdown({ target, lang, live }: { target: Date; lang: Lang; live: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  // The section renders immediately so the scroll-reveal observer can find it;
  // the digits fill in once the client clock is known.
  const diff = now === null ? 0 : Math.max(0, target.getTime() - now);
  const t = UI[lang];
  const cells: Array<[number, string]> = [
    [Math.floor(diff / 86_400_000), t.days],
    [Math.floor((diff % 86_400_000) / 3_600_000), t.hours],
    [Math.floor((diff % 3_600_000) / 60_000), t.minutes],
    [Math.floor((diff % 60_000) / 1000), t.seconds],
  ];
  return (
    <section className={styles.countdown} aria-label={t.left} data-reveal="">
      <p className={styles.countLabel}>{t.left}</p>
      <div className={styles.countRow}>
        {cells.map(([value, label]) => (
          <div key={label} className={styles.countCell}>
            <strong key={value} className={styles.tick}>{now === null ? "··" : String(value).padStart(2, "0")}</strong>
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
        backdrop: <Particles className={styles.petals} count={14} />,
        heroTop: <PeonyCluster className={styles.peonyTop} />,
        heroBottom: <PeonyCluster className={styles.peonyBottom} flip />,
        divider: <PeonyCluster className={styles.peonyDivider} />,
      };
    case "ornament":
      return {
        backdrop: <Particles className={styles.sparks} count={22} />,
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
        backdrop: (
          <>
            <StarField className={styles.stars} />
            <Particles className={styles.shooting} count={3} />
          </>
        ),
        heroTop: <MoonConstellation className={styles.moon} />,
        divider: <span className={styles.sparkle}>✦</span>,
      };
    case "deco":
      return {
        backdrop: <Particles className={styles.glints} count={12} />,
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
        backdrop: (
          <>
            <Clouds className={styles.clouds} />
            <Particles className={styles.hearts} count={12} />
          </>
        ),
        heroTop: <Balloons className={styles.balloons} colors={REVEAL} />,
        divider: <span className={styles.question}>?</span>,
      };
    case "tianshan":
      return {
        heroBottom: (
          <div className={styles.range}>
            <Mountains className={styles.mountains} />
            <span className={styles.mist} />
          </div>
        ),
        divider: <span className={styles.peak} />,
      };
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
        backdrop: (
          <>
            <Clouds className={styles.clouds} />
            <Particles className={styles.bubbles} count={10} />
          </>
        ),
        heroTop: <Footprints className={styles.footprints} />,
        divider: <Cord className={styles.cord} />,
      };
    case "steppe":
      return {
        backdrop: <SteppeSunset className={styles.steppe} />,
        divider: <span className={styles.sunDot} />,
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

type RsvpAnswer = "yes" | "family" | "no";

function RsvpForm({ slug, live, t }: { slug?: string; live: boolean; t: Record<string, string> }) {
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState<RsvpAnswer | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const enabled = live && Boolean(slug);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled) return;
    if (!name.trim()) return setError(t.nameErr);
    if (!answer) return setError(t.choiceErr);
    setError("");
    setState("sending");
    try {
      const response = await fetch("/api/invite/rsvp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, name: name.trim(), answer }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState("done");
    } catch {
      setState("idle");
      setError(t.sendErr);
    }
  }

  if (state === "done") return <p className={styles.rsvpThanks} role="status">{t.thanks}</p>;
  const options: Array<[RsvpAnswer, string]> = [["yes", t.ansYes], ["family", t.ansFamily], ["no", t.ansNo]];
  return (
    <form className={styles.rsvpForm} onSubmit={submit} noValidate>
      <input
        className={styles.rsvpInput}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError("");
        }}
        placeholder={t.yourName}
        aria-label={t.yourName}
        maxLength={80}
        disabled={!enabled}
      />
      <div className={styles.rsvpOptions} role="radiogroup">
        {options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={answer === value}
            className={`${styles.rsvpOption} ${answer === value ? styles.rsvpOptionOn : ""}`}
            onClick={() => {
              setAnswer(value);
              setError("");
            }}
            disabled={!enabled}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className={styles.rsvpError} role="alert">{error}</p> : null}
      <button type="submit" className={styles.rsvpSend} disabled={!enabled || state === "sending"}>
        {state === "sending" ? t.sending : t.send}
      </button>
      {!enabled ? <p className={styles.note}>{t.previewNote}</p> : null}
    </form>
  );
}

function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  return (
    <div className={styles.swatches} aria-hidden="true">
      {colors.map((c) => (
        <span key={c} style={{ background: c }} />
      ))}
    </div>
  );
}

export function InvitationView({ invitation, live = true, slug }: { invitation: Invitation; live?: boolean; slug?: string }) {
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

  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = card.current;
    if (!live || !root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.setAttribute("data-shown", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-shown", "");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [live, invitation]);

  const classes = [
    styles.root,
    styles[`t_${id}`],
    meta.paletteable ? styles[`p_${invitation.palette}`] : "",
    live ? styles.live : styles.still,
  ].join(" ");

  return (
    <article ref={card} className={classes} lang={lang}>
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

      {id === "golden" ? (
        <>
          <header className={styles.gHero}>
            {invitation.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.gHeroImg} src={invitation.photos[0]} alt="" />
            ) : (
              <SteppeSunset className={styles.gHeroArt} />
            )}
            <span className={styles.gShade} />
            <p className={styles.gHeroTitle}>{EVENT_LABELS_LANG[lang][invitation.eventType] ?? EVENT_LABELS[invitation.eventType]}</p>
          </header>

          <section className={styles.gCard} data-reveal="">
            <ScallopCap className={styles.gCap} />
            <div className={styles.gCardBody}>
              {invitation.hosts.length >= 2 && !invitation.title ? (
                <h1 className={styles.gNames}>
                  <span>{invitation.hosts[0]}</span>
                  <GoldHeart className={styles.gHeart} />
                  <span>{invitation.hosts[1]}</span>
                </h1>
              ) : (
                <h1 className={styles.gNames}>{displayTitle(invitation)}</h1>
              )}
              {invitation.date ? <p className={styles.gDate}>{shortDate(invitation)}</p> : null}
              {message ? <p className={styles.gMessage}>{message}</p> : null}
              {invitation.inviters ? (
                <>
                  <span className={styles.gRule} aria-hidden="true" />
                  <p className={styles.gLabel}>{t.hosts}:</p>
                  <p className={styles.gInviters}>{invitation.inviters}</p>
                </>
              ) : null}
            </div>
            <ScallopCap className={`${styles.gCap} ${styles.gCapBottom}`} />
          </section>

          {invitation.venue.name || invitation.venue.address ? (
            <section
              className={styles.gBand}
              style={invitation.photos[1] ? { backgroundImage: `url("${invitation.photos[1]}")` } : undefined}
              data-reveal=""
            >
              <span className={styles.gShade} />
              <div className={styles.gBandBody}>
                {invitation.time ? <p className={styles.gTime}>{invitation.time}</p> : null}
                <p className={styles.gVenue}>
                  {[invitation.venue.address, invitation.venue.name].filter(Boolean).join(", ")}
                </p>
                <div className={styles.actions}>
                  {mapHref ? <a className={styles.gPill} href={mapHref} target="_blank" rel="noopener noreferrer">{t.map}</a> : null}
                  {calHref ? <a className={`${styles.gPill} ${styles.gPillGhost}`} href={calHref} target="_blank" rel="noopener noreferrer">{t.calendar}</a> : null}
                </div>
              </div>
            </section>
          ) : null}

          <div className={styles.gPaper}>
            {invitation.date ? <MonthCalendar date={invitation.date} lang={lang} title={formatDate(invitation, lang).replace(/^[^,]+,\s*/u, "")} /> : null}
            {target && target.getTime() > Date.now() - 86_400_000 ? <Countdown target={target} lang={lang} live={live} /> : null}
            {invitation.program.length ? (
              <section className={styles.section} data-reveal="">
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
          </div>

          {invitation.dressCode || invitation.dressColors.length ? (
            <section
              className={styles.gBand}
              style={invitation.photos[2] ? { backgroundImage: `url("${invitation.photos[2]}")` } : undefined}
              data-reveal=""
            >
              <span className={styles.gShade} />
              <div className={styles.gBandBody}>
                <h2 className={styles.gBandTitle}>{t.dress}</h2>
                {invitation.dressCode ? <p className={styles.gVenue}>{invitation.dressCode}</p> : null}
                <Swatches colors={invitation.dressColors} />
              </div>
            </section>
          ) : null}

          {invitation.rsvpEnabled ? (
            <section className={styles.gCard} data-reveal="">
              <ScallopCap className={styles.gCap} />
              <div className={styles.gCardBody}>
                <h2 className={styles.gAsk}>{t.rsvpAsk}</h2>
                {invitation.rsvpDeadline ? (
                  <p className={styles.gLabel}>
                    {t.deadline}{" "}
                    {new Date(`${invitation.rsvpDeadline}T12:00:00+06:00`).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", timeZone: "Asia/Bishkek" })}
                  </p>
                ) : null}
                <RsvpForm slug={slug} live={live} t={t} />
              </div>
              <ScallopCap className={`${styles.gCap} ${styles.gCapBottom}`} />
            </section>
          ) : null}

          {invitation.contacts.length ? (
            <section className={`${styles.section} ${styles.gContacts}`} data-reveal="">
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
          <footer className={`${styles.footer} ${styles.gFooter}`} data-reveal="">
            <p className={styles.wait}>{t.wait}</p>
          </footer>
        </>
      ) : (
        <>
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
          <figure className={styles.photoMain} data-reveal="">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={invitation.photos[0]} alt="" loading={live ? "eager" : "lazy"} />
          </figure>
        ) : null}

        {message ? <p className={styles.message} data-reveal="">{message}</p> : null}

        {invitation.inviters ? (
          <section className={`${styles.section} ${styles.inviters}`} data-reveal="">
            <h2>{t.hosts}</h2>
            <p>{invitation.inviters}</p>
          </section>
        ) : null}

        <div className={styles.divider} data-reveal="">{decor.divider}</div>

        {target && target.getTime() > Date.now() - 86_400_000 ? <Countdown target={target} lang={lang} live={live} /> : null}

        {invitation.date ? <MonthCalendar date={invitation.date} lang={lang} title={t.calendar_title} /> : null}

        {invitation.program.length ? (
          <section className={styles.section} data-reveal="">
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
          <section className={`${styles.section} ${styles.venue}`} data-reveal="">
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
          <section className={styles.section} data-reveal="">
            <h2>{t.photos}</h2>
            <div className={styles.gallery}>
              {invitation.photos.slice(1).map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" loading="lazy" />
              ))}
            </div>
          </section>
        ) : null}

        {invitation.dressCode || invitation.dressColors.length ? (
          <section className={styles.section} data-reveal="">
            <h2>{t.dress}</h2>
            {invitation.dressCode ? <p className={styles.muted}>{invitation.dressCode}</p> : null}
            <Swatches colors={invitation.dressColors} />
          </section>
        ) : null}

        {invitation.rsvpEnabled ? (
          <section className={`${styles.section} ${styles.rsvp}`} data-reveal="">
            <h2>{t.rsvp}</h2>
            {invitation.rsvpDeadline ? (
              <p className={styles.muted}>
                {t.deadline}{" "}
                {new Date(`${invitation.rsvpDeadline}T12:00:00+06:00`).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", timeZone: "Asia/Bishkek" })}
              </p>
            ) : null}
            <RsvpForm slug={slug} live={live} t={t} />
          </section>
        ) : null}

        {invitation.contacts.length ? (
          <section className={styles.section} data-reveal="">
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

      <footer className={styles.footer} data-reveal="">
        <div className={styles.divider}>{decor.divider}</div>
        <p className={styles.wait}>{t.wait}</p>
        {mono.length ? <p className={styles.footMono}>{mono.join(" & ")}</p> : null}
        {invitation.date ? <p className={styles.footDate}>{shortDate(invitation)}</p> : null}
      </footer>
        </>
      )}
    </article>
  );
}
