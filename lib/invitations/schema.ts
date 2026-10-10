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

export const TEMPLATE_IDS = ["minimal", "floral", "ornament"] as const;
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

export const TEMPLATE_LABELS: Record<TemplateId, { name: string; note: string }> = {
  minimal: { name: "Минимализм", note: "Чистая типографика и много воздуха" },
  floral: { name: "Цветочный", note: "Нежные ветви и тёплые оттенки" },
  ornament: { name: "Орнамент", note: "Геометрический узор в национальном духе" },
};

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
  const palettes: Record<TemplateId, Palette> = { minimal: "ivory", floral: "blush", ornament: "night" };
  return {
    ...base,
    ...samples[eventType],
    templateId,
    palette: palettes[templateId],
    date: "2027-06-12",
    time: "17:00",
    venue: { name: "Ресторан «Тянь-Шань»", address: "Бишкек, проспект Чуй", mapUrl: "" },
    dressCode: "",
  };
}
