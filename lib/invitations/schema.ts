export const EVENT_TYPES = [
  "wedding",
  "birthday",
  "gender_party",
  "tushoo_toi",
  "kyz_uzatuu",
  "corporate",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LANGUAGES = ["ru", "ky", "en"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const TEMPLATE_IDS = [
  "minimal",
  "floral",
  "ornament",
  "shyrdak",
  "tunduk",
  "celestial",
  "deco",
  "confetti",
  "reveal",
  "tianshan",
  "neon",
  "postcard",
  "steps",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const PALETTES = ["ivory", "blush", "sage", "night", "gold", "sky"] as const;
export type Palette = (typeof PALETTES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  wedding: "Свадьба",
  birthday: "День рождения",
  gender_party: "Гендер-пати",
  tushoo_toi: "Тушоо той",
  kyz_uzatuu: "Кыз узатуу",
  corporate: "Корпоратив",
};

type TemplateMeta = {
  name: string;
  note: string;
  /** Whether the client's palette choice recolours this template. */
  paletteable: boolean;
  defaultPalette: Palette;
  /** Colour around the invitation card on the guest page. */
  pageBg: string;
  /** Events this template is designed for; shown first in the gallery. */
  events: EventType[];
  /** Google Fonts families (all with Kyrgyz Cyrillic coverage). */
  fonts: string[];
};

export const TEMPLATE_META: Record<TemplateId, TemplateMeta> = {
  minimal: {
    name: "Белый шёлк", note: "Монограмма, тонкие линии и много воздуха",
    paletteable: true, defaultPalette: "ivory", pageBg: "#e9e4da",
    events: ["wedding", "corporate", "birthday"],
    fonts: ["Cormorant Garamond:ital,wght@0,300;0,500;1,300", "Montserrat:wght@300;500"],
  },
  floral: {
    name: "Пионы", note: "Акварельные пионы и рукописные имена",
    paletteable: true, defaultPalette: "blush", pageBg: "#eddcd8",
    events: ["wedding", "kyz_uzatuu", "birthday"],
    fonts: ["Great Vibes", "Cormorant Garamond:ital,wght@0,400;0,500;1,400", "Montserrat:wght@300;500"],
  },
  ornament: {
    name: "Ою", note: "Золотой узор кочкор мүйүз на ночном синем",
    paletteable: false, defaultPalette: "night", pageBg: "#070b16",
    events: ["wedding", "kyz_uzatuu", "tushoo_toi"],
    fonts: ["Forum", "Lora:ital@0;1"],
  },
  shyrdak: {
    name: "Шырдак", note: "Войлочная мозаика: красный, индиго, охра",
    paletteable: false, defaultPalette: "gold", pageBg: "#2b1d16",
    events: ["kyz_uzatuu", "tushoo_toi", "wedding"],
    fonts: ["Yeseva One", "Alice"],
  },
  tunduk: {
    name: "Тундук", note: "Купол юрты над именами, тёплые степные тона",
    paletteable: false, defaultPalette: "ivory", pageBg: "#d9c7a6",
    events: ["wedding", "kyz_uzatuu", "tushoo_toi", "birthday"],
    fonts: ["Philosopher:ital,wght@0,400;0,700;1,400", "Lora:ital@0;1"],
  },
  celestial: {
    name: "Звёздная ночь", note: "Мерцающие звёзды, луна и созвездие",
    paletteable: false, defaultPalette: "night", pageBg: "#05081a",
    events: ["wedding", "birthday", "corporate"],
    fonts: ["Cormorant Garamond:ital,wght@0,300;0,500;1,300", "Montserrat:wght@300;500"],
  },
  deco: {
    name: "Ар-деко", note: "Изумруд и золото, веер-солнце, ступенчатая рамка",
    paletteable: false, defaultPalette: "gold", pageBg: "#071f1b",
    events: ["corporate", "wedding", "birthday"],
    fonts: ["Oswald:wght@300;500", "Cormorant Garamond:ital,wght@0,400;1,400"],
  },
  confetti: {
    name: "Конфетти", note: "Шары, конфетти и яркий праздничный шрифт",
    paletteable: false, defaultPalette: "sky", pageBg: "#ffe2c4",
    events: ["birthday", "corporate", "gender_party"],
    fonts: ["Unbounded:wght@500;800", "Nunito:wght@400;700"],
  },
  reveal: {
    name: "Он или она?", note: "Розовый и голубой, шары и главный вопрос",
    paletteable: false, defaultPalette: "blush", pageBg: "#e8dcef",
    events: ["gender_party", "birthday"],
    fonts: ["Comfortaa:wght@400;700", "Nunito:wght@400;700"],
  },
  tianshan: {
    name: "Тянь-Шань", note: "Слои гор на рассвете",
    paletteable: false, defaultPalette: "sky", pageBg: "#c9d7e3",
    events: ["wedding", "birthday", "corporate"],
    fonts: ["Prata", "Manrope:wght@400;600"],
  },
  neon: {
    name: "Неон", note: "Неоновое свечение и сетка-горизонт",
    paletteable: false, defaultPalette: "night", pageBg: "#05020f",
    events: ["corporate", "birthday"],
    fonts: ["Unbounded:wght@400;700", "Exo 2:wght@400;600"],
  },
  postcard: {
    name: "Ретро-открытка", note: "Бумага, почтовая марка и штемпель с датой",
    paletteable: false, defaultPalette: "ivory", pageBg: "#c8b79a",
    events: ["birthday", "wedding", "corporate"],
    fonts: ["Old Standard TT:ital,wght@0,400;0,700;1,400", "Bad Script"],
  },
  steps: {
    name: "Первые шаги", note: "Следы ножек и чёрно-белая тушоо-верёвка",
    paletteable: false, defaultPalette: "sage", pageBg: "#d4ece2",
    events: ["tushoo_toi", "birthday", "gender_party"],
    fonts: ["Comfortaa:wght@400;700", "Caveat:wght@500;700"],
  },
};

export const TEMPLATE_LABELS: Record<TemplateId, { name: string; note: string }> = Object.fromEntries(
  TEMPLATE_IDS.map((id) => [id, { name: TEMPLATE_META[id].name, note: TEMPLATE_META[id].note }]),
) as Record<TemplateId, { name: string; note: string }>;

export function fontsHref(ids: readonly TemplateId[]): string {
  const families = [...new Set(ids.flatMap((id) => TEMPLATE_META[id].fonts))];
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replace(/ /gu, "+")}`).join("&")}&display=swap`;
}

/** Templates ordered for the gallery: the ones designed for this event first. */
export function templatesFor(eventType: EventType): TemplateId[] {
  const fit = TEMPLATE_IDS.filter((id) => TEMPLATE_META[id].events.includes(eventType));
  return [...fit, ...TEMPLATE_IDS.filter((id) => !fit.includes(id))];
}

export type ProgramItem = { time: string; title: string };
export type Contact = { name: string; phone: string };
export type Venue = { name: string; address: string; mapUrl: string };

export type Invitation = {
  eventType: EventType;
  templateId: TemplateId;
  palette: Palette;
  languages: Lang[];
  title: string;
  hosts: string[];
  date: string;
  time: string;
  venue: Venue;
  message: Partial<Record<Lang, string>>;
  program: ProgramItem[];
  dressCode: string;
  contacts: Contact[];
  photos: string[];
  rsvpEnabled: boolean;
  rsvpDeadline: string;
  /** YouTube video id for background music, "" when none. */
  musicVideoId: string;
  /** Second of the video where the music starts. */
  musicStart: number;
  notes: string;
};

export function emptyInvitation(eventType: EventType = "wedding"): Invitation {
  return {
    eventType,
    templateId: "minimal",
    palette: "ivory",
    languages: ["ru"],
    title: "",
    hosts: [],
    date: "",
    time: "",
    venue: { name: "", address: "", mapUrl: "" },
    message: {},
    program: [],
    dressCode: "",
    contacts: [],
    photos: [],
    rsvpEnabled: true,
    rsvpDeadline: "",
    musicVideoId: "",
    musicStart: 0,
    notes: "",
  };
}

const LIMITS = { short: 120, text: 1200, hosts: 4, program: 12, contacts: 4, photos: 8 };

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "").trim().slice(0, max);
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : undefined;
}

function isoDate(value: unknown): string | undefined {
  const s = str(value, 10);
  if (s === undefined) return undefined;
  if (s === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? undefined : s;
}

function clock(value: unknown): string | undefined {
  const s = str(value, 5);
  if (s === undefined) return undefined;
  if (s === "") return "";
  const m = /^(\d{1,2}):(\d{2})$/u.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function httpsUrl(value: unknown, allowedHosts?: RegExp): string | undefined {
  const s = str(value, 600);
  if (s === undefined) return undefined;
  if (s === "") return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return undefined;
    if (allowedHosts && !allowedHosts.test(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const MAP_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|2gis\.[a-z.]+|go\.2gis\.com|yandex\.[a-z.]+|maps\.apple\.com)$/iu;
const PHOTO_HOSTS = /(^|\.)supabase\.co$/iu;

const YT_ID = /^[A-Za-z0-9_-]{11}$/u;
const YT_HOSTS = /^(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com)$/iu;

function parseSeconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/u.test(value)) return Math.min(36_000, Number(value));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (!m) return 0;
  return Math.min(36_000, (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0));
}

/** Extracts the video id and start second from any common YouTube link. */
export function parseYouTube(raw: string): { id: string; start: number } | null {
  let url: URL;
  try {
    url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  let id = "";
  if (/^(www\.)?youtu\.be$/iu.test(url.hostname)) {
    id = url.pathname.split("/")[1] ?? "";
  } else if (YT_HOSTS.test(url.hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? "";
  }
  if (!YT_ID.test(id)) return null;
  return { id, start: parseSeconds(url.searchParams.get("t") ?? url.searchParams.get("start")) };
}

/**
 * Applies an untrusted patch (from the model or the client) to an invitation.
 * Every field is validated; anything malformed is ignored rather than stored.
 */
export function applyInvitationPatch(base: Invitation, patch: unknown): Invitation {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const p = patch as Record<string, unknown>;
  const next: Invitation = {
    ...base,
    venue: { ...base.venue },
    message: { ...base.message },
    hosts: [...base.hosts],
    program: [...base.program],
    contacts: [...base.contacts],
    photos: [...base.photos],
    languages: [...base.languages],
  };

  next.eventType = oneOf(p.eventType, EVENT_TYPES) ?? next.eventType;
  next.templateId = oneOf(p.templateId, TEMPLATE_IDS) ?? next.templateId;
  next.palette = oneOf(p.palette, PALETTES) ?? next.palette;
  next.title = str(p.title, LIMITS.short) ?? next.title;
  next.date = isoDate(p.date) ?? next.date;
  next.time = clock(p.time) ?? next.time;
  next.dressCode = str(p.dressCode, LIMITS.short * 2) ?? next.dressCode;
  next.notes = str(p.notes, LIMITS.text) ?? next.notes;
  next.rsvpDeadline = isoDate(p.rsvpDeadline) ?? next.rsvpDeadline;
  if (typeof p.musicUrl === "string") {
    if (!p.musicUrl.trim()) {
      next.musicVideoId = "";
      next.musicStart = 0;
    } else {
      const music = parseYouTube(p.musicUrl);
      if (music) {
        next.musicVideoId = music.id;
        next.musicStart = music.start;
      }
    }
  }
  // Stored rows carry the parsed fields directly.
  if (typeof p.musicVideoId === "string" && (p.musicVideoId === "" || YT_ID.test(p.musicVideoId))) {
    next.musicVideoId = p.musicVideoId;
  }
  if (typeof p.musicStart === "number" && Number.isFinite(p.musicStart)) {
    next.musicStart = Math.max(0, Math.min(36_000, Math.floor(p.musicStart)));
  }
  if (typeof p.rsvpEnabled === "boolean") next.rsvpEnabled = p.rsvpEnabled;

  if (Array.isArray(p.languages)) {
    const langs = [...new Set(p.languages.map((l) => oneOf(l, LANGUAGES)).filter((l): l is Lang => Boolean(l)))];
    if (langs.length) next.languages = langs;
  }
  if (Array.isArray(p.hosts)) {
    next.hosts = p.hosts.map((h) => str(h, 60)).filter((h): h is string => Boolean(h)).slice(0, LIMITS.hosts);
  }
  if (p.venue && typeof p.venue === "object" && !Array.isArray(p.venue)) {
    const v = p.venue as Record<string, unknown>;
    next.venue = {
      name: str(v.name, LIMITS.short) ?? next.venue.name,
      address: str(v.address, LIMITS.short * 2) ?? next.venue.address,
      mapUrl: httpsUrl(v.mapUrl, MAP_HOSTS) ?? next.venue.mapUrl,
    };
  }
  if (p.message && typeof p.message === "object" && !Array.isArray(p.message)) {
    for (const lang of LANGUAGES) {
      const text = str((p.message as Record<string, unknown>)[lang], LIMITS.text);
      if (text !== undefined) {
        if (text) next.message[lang] = text;
        else delete next.message[lang];
      }
    }
  }
  if (Array.isArray(p.program)) {
    next.program = p.program
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const i = item as Record<string, unknown>;
        const title = str(i.title, LIMITS.short);
        if (!title) return null;
        return { time: clock(i.time) ?? "", title };
      })
      .filter((x): x is ProgramItem => Boolean(x))
      .slice(0, LIMITS.program);
  }
  if (Array.isArray(p.contacts)) {
    next.contacts = p.contacts
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const c = item as Record<string, unknown>;
        const name = str(c.name, 60);
        const phone = str(c.phone, 24)?.replace(/[^\d+()\-\s]/gu, "");
        return name && phone ? { name, phone } : null;
      })
      .filter((x): x is Contact => Boolean(x))
      .slice(0, LIMITS.contacts);
  }
  if (Array.isArray(p.photos)) {
    next.photos = p.photos
      .map((u) => httpsUrl(u, PHOTO_HOSTS))
      .filter((u): u is string => Boolean(u))
      .slice(0, LIMITS.photos);
  }
  return next;
}

/** Fields the owner of the event still has to provide before the invitation can be submitted. */
export function missingFields(inv: Invitation): string[] {
  const missing: string[] = [];
  const needsHosts = inv.eventType !== "corporate";
  if (needsHosts && !inv.hosts.length) missing.push("имена");
  if (!inv.title && !inv.hosts.length) missing.push("название события");
  if (!inv.date) missing.push("дата");
  if (!inv.time) missing.push("время");
  if (!inv.venue.name && !inv.venue.address) missing.push("место");
  if (!inv.languages.some((l) => inv.message[l])) missing.push("текст приглашения");
  return missing;
}

export function displayTitle(inv: Invitation): string {
  if (inv.title) return inv.title;
  if (inv.eventType === "wedding" && inv.hosts.length >= 2) return `${inv.hosts[0]} & ${inv.hosts[1]}`;
  return inv.hosts.join(" и ") || EVENT_LABELS[inv.eventType];
}

/** Sample content used by the template gallery. */
export function sampleInvitation(templateId: TemplateId, eventType: EventType = "wedding"): Invitation {
  const base = emptyInvitation(eventType);
  const samples: Record<EventType, Partial<Invitation>> = {
    wedding: {
      hosts: ["Айбек", "Айпери"],
      message: { ru: "С радостью приглашаем вас разделить с нами самый важный день нашей жизни." },
      program: [
        { time: "17:00", title: "Сбор гостей" },
        { time: "18:00", title: "Торжественная часть" },
        { time: "19:00", title: "Праздничный ужин" },
      ],
    },
    birthday: { hosts: ["Алина"], title: "Алине 30", message: { ru: "Приглашаю отметить мой день рождения вместе!" } },
    gender_party: { hosts: ["Нурлан", "Жамиля"], title: "Мальчик или девочка?", message: { ru: "Узнаем вместе, кто скоро появится в нашей семье!" } },
    tushoo_toi: { hosts: ["Эмир"], title: "Тушоо той Эмира", message: { ru: "Приглашаем на тушоо той — первые шаги нашего сына." } },
    kyz_uzatuu: { hosts: ["Асель"], title: "Кыз узатуу", message: { ru: "Приглашаем проводить нашу дочь в новую жизнь." } },
    corporate: { title: "Новогодний вечер", hosts: [], message: { ru: "Приглашаем команду на праздничный вечер." } },
  };
  return {
    ...base,
    program: [
      { time: "17:00", title: "Сбор гостей" },
      { time: "18:00", title: "Торжественная часть" },
      { time: "19:00", title: "Праздничный ужин" },
    ],
    ...samples[eventType],
    templateId,
    palette: TEMPLATE_META[templateId].defaultPalette,
    date: "2027-06-12",
    time: "17:00",
    venue: { name: "Ресторан «Ала-Тоо»", address: "Бишкек, проспект Чуй", mapUrl: "" },
    dressCode: "Нарядно, в светлых тонах",
  };
}
