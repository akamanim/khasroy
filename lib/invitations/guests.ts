// Turns raw RSVP rows into the organizer's guest list. A guest who answered twice is counted once,
// with their latest answer (rows arrive newest first).

export type RsvpRow = { guest_name: string; answer: "yes" | "family" | "no"; party_size?: number; created_at: string };
export type GuestEntry = { name: string; answer: RsvpRow["answer"]; people: number; at: string; changes: number };
export type GuestSummary = { guests: GuestEntry[]; coming: number; people: number; declined: number; responses: number };

export const ANSWER_LABEL: Record<RsvpRow["answer"], string> = { yes: "Придёт", family: "Придёт с семьёй", no: "Не сможет" };

export function summarizeGuests(rows: RsvpRow[]): GuestSummary {
  const byName = new Map<string, GuestEntry>();
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const row of sorted) {
    const key = row.guest_name.trim().toLowerCase().replace(/\s+/gu, " ");
    const existing = byName.get(key);
    if (existing) {
      existing.changes += 1;
      continue;
    }
    const people = row.answer === "no" ? 0 : row.answer === "yes" ? 1 : Math.max(2, Number(row.party_size) || 2);
    byName.set(key, { name: row.guest_name.trim(), answer: row.answer, people, at: row.created_at, changes: 0 });
  }
  const guests = [...byName.values()];
  return {
    guests,
    coming: guests.filter((g) => g.answer !== "no").length,
    people: guests.reduce((n, g) => n + g.people, 0),
    declined: guests.filter((g) => g.answer === "no").length,
    responses: rows.length,
  };
}
