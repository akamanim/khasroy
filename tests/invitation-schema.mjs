import assert from "node:assert/strict";
import {
  TEMPLATE_IDS,
  TEMPLATE_META,
  EVENT_TYPES,
  templatesFor,
  applyInvitationPatch,
  displayTitle,
  emptyInvitation,
  missingFields,
  sampleInvitation,
  parseYouTube,
} from "../lib/invitations/schema.ts";

const base = emptyInvitation("wedding");

// Valid patch is applied.
let inv = applyInvitationPatch(base, {
  hosts: ["Айбек", "Айпери"],
  date: "2027-06-12",
  time: "7:30",
  languages: ["ru", "ky", "ru", "xx"],
  venue: { name: "Тянь-Шань", address: "Бишкек", mapUrl: "https://2gis.kg/bishkek/geo/1" },
  message: { ru: "Приглашаем!", ky: "Чакырабыз!" },
  program: [{ time: "18:00", title: "Сбор гостей" }, { title: "" }, "bad"],
  templateId: "ornament",
  palette: "night",
});
assert.deepEqual(inv.hosts, ["Айбек", "Айпери"]);
assert.equal(inv.time, "07:30", "time is normalised");
assert.deepEqual(inv.languages, ["ru", "ky"], "unknown and duplicate languages dropped");
assert.equal(inv.program.length, 1, "empty and malformed program items dropped");
assert.equal(inv.templateId, "ornament");
assert.equal(displayTitle(inv), "Айбек & Айпери");
assert.deepEqual(missingFields(inv), []);

// Malformed values are ignored, previous values kept.
const kept = applyInvitationPatch(inv, {
  date: "2027-02-30",
  time: "25:00",
  templateId: "vaporwave",
  eventType: "funeral",
  palette: "red",
  venue: { mapUrl: "javascript:alert(1)" },
  photos: ["https://evil.example.com/a.jpg", "http://kebzlrmzbygxwfubnykq.supabase.co/x.jpg"],
});
assert.equal(kept.date, "2027-06-12", "impossible date rejected");
assert.equal(kept.time, "07:30", "invalid time rejected");
assert.equal(kept.templateId, "ornament");
assert.equal(kept.eventType, "wedding");
assert.equal(kept.palette, "night");
assert.equal(kept.venue.mapUrl, "https://2gis.kg/bishkek/geo/1", "non-https map url rejected");
assert.deepEqual(kept.photos, [], "foreign and insecure photo hosts rejected");

// Allowed photo host and length limits.
const photos = applyInvitationPatch(base, {
  photos: Array.from({ length: 12 }, (_, i) => `https://kebzlrmzbygxwfubnykq.supabase.co/storage/v1/object/public/invitations/s/${i}.jpg`),
  title: "x".repeat(500),
});
assert.equal(photos.photos.length, 8, "photos capped");
assert.equal(photos.title.length, 120, "title capped");

// Clearing a language text.
const cleared = applyInvitationPatch(inv, { message: { ky: "" } });
assert.equal(cleared.message.ky, undefined);
assert.equal(cleared.message.ru, "Приглашаем!");

// Non-object patches are no-ops; base is never mutated.
assert.equal(applyInvitationPatch(inv, null), inv);
assert.equal(applyInvitationPatch(inv, [1, 2]), inv);
assert.deepEqual(base.hosts, [], "base untouched");

// Missing fields depend on event type.
assert.ok(missingFields(emptyInvitation("wedding")).includes("имена"));
const corporate = applyInvitationPatch(emptyInvitation("corporate"), { title: "Новый год" });
assert.ok(!missingFields(corporate).includes("имена"), "corporate events need no host names");

// Every template and event type has gallery sample content.
for (const t of TEMPLATE_IDS) for (const e of EVENT_TYPES) {
  const s = sampleInvitation(t, e);
  assert.equal(s.templateId, t);
  assert.ok(displayTitle(s).length > 0);
}

// Template metadata is complete and every event has designed-for templates first.
for (const t of TEMPLATE_IDS) {
  const m = TEMPLATE_META[t];
  assert.ok(m && m.name && m.fonts.length && m.events.length && /^#[0-9a-f]{6}$/iu.test(m.pageBg), `meta for ${t}`);
}
for (const e of EVENT_TYPES) {
  const order = templatesFor(e);
  assert.equal(order.length, TEMPLATE_IDS.length, "gallery lists every template");
  assert.ok(TEMPLATE_META[order[0]].events.includes(e), `first template fits ${e}`);
}

// YouTube links for background music.
const ID = "dQw4w9WgXcQ";
for (const link of [
  `https://www.youtube.com/watch?v=${ID}`,
  `https://youtu.be/${ID}`,
  `youtube.com/watch?v=${ID}&list=RD`,
  `https://m.youtube.com/watch?v=${ID}`,
  `https://music.youtube.com/watch?v=${ID}&si=abc`,
  `https://www.youtube.com/shorts/${ID}`,
  `https://www.youtube.com/embed/${ID}`,
]) assert.equal(parseYouTube(link)?.id, ID, link);
assert.equal(parseYouTube(`https://youtu.be/${ID}?t=95`)?.start, 95);
assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)?.start, 90);
assert.equal(parseYouTube("https://vimeo.com/12345"), null);
assert.equal(parseYouTube("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"), null);
assert.equal(parseYouTube("https://www.youtube.com/watch?v=short"), null);
const withMusic = applyInvitationPatch(base, { musicUrl: `https://youtu.be/${ID}?t=30` });
assert.equal(withMusic.musicVideoId, ID);
assert.equal(withMusic.musicStart, 30);
assert.equal(applyInvitationPatch(withMusic, { musicUrl: "https://example.com/song.mp3" }).musicVideoId, ID, "bad link keeps music");
assert.equal(applyInvitationPatch(withMusic, { musicUrl: "" }).musicVideoId, "", "empty link removes music");
assert.equal(applyInvitationPatch(base, { musicVideoId: "<script>" }).musicVideoId, "", "stored id is validated");
assert.equal(applyInvitationPatch(emptyInvitation(), withMusic).musicVideoId, ID, "stored row round-trips");

// Dress-code colours.
const colors = applyInvitationPatch(base, { dressColors: ["#1D1D1F", "#1d1d1f", "red", "#abc", "#9b2335", 5] });
assert.deepEqual(colors.dressColors, ["#1d1d1f", "#9b2335"], "only #rrggbb, deduplicated, lower-case");

console.log("invitation schema: ok");
