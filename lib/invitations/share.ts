import { EVENT_LABELS, displayTitle, type Invitation } from "./schema.ts";

// Helpers for sharing an invitation: personal guest links (?to=) and the link preview text
// WhatsApp/Telegram show. Pure functions, unit-tested.

export const PUBLIC_ORIGIN = (process.env.KHASROY_PUBLIC_URL || "https://khasroy.vercel.app").replace(/\/+$/u, "");

/** Cleans a guest name from the URL: no control characters or markup, at most 60 characters. */
export function guestName(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f<>{}[\]\\]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 60);
}

export function personalLink(slug: string, name: string): string {
  const clean = guestName(name);
  return clean ? `${PUBLIC_ORIGIN}/i/${slug}?to=${encodeURIComponent(clean)}` : `${PUBLIC_ORIGIN}/i/${slug}`;
}

/** One name per line (or separated by ; ), duplicates removed, at most 500. */
export function parseGuestList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n;]+/u)) {
    const name = guestName(part);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
    if (out.length >= 500) break;
  }
  return out;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function shareDate(inv: Invitation): string {
  const m = inv.date.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}${inv.time ? `, ${inv.time}` : ""}`;
}

export function shareTitle(inv: Invitation, guest = ""): string {
  const title = displayTitle(inv);
  const greeting = guest ? (inv.languages[0] === "ky" ? `Урматтуу ${guest}! ` : `${guest}, приглашаем вас! `) : "";
  return `${greeting}${title}`.slice(0, 110);
}

export function shareDescription(inv: Invitation): string {
  const parts = [EVENT_LABELS[inv.eventType], shareDate(inv), inv.venue.name].filter(Boolean);
  return parts.join(" · ").slice(0, 200);
}

/** WhatsApp "click to chat" link with the message prefilled. */
export function whatsappShare(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
