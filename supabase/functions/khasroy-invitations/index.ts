import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Storage gateway for the invitation studio. Only the Khasroy server calls it,
// authenticating with the owner key; public clients never reach it directly.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "invitations";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ACTIVE = "status=in.(draft,submitted,approved,published)";
const ROW = "id,slug,alias,status,event_type,template_id,data,history,message_count,contact,created_at,updated_at";
// The guest-list token goes only to the organizer (their own session, owner panel), never to guests.
const ROW_PRIVATE = `${ROW},manage_token`;
const STATUSES = ["draft", "submitted", "approved", "published", "archived"];

const knownOwners = new Set<string>();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`database ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

async function ownerAllowed(hash: string) {
  if (knownOwners.has(hash)) return true;
  const rows = await (await db(`khasroy_skills?owner_hash=eq.${hash}&select=owner_hash&limit=1`)).json();
  const ok = Array.isArray(rows) && rows.length > 0;
  if (ok) knownOwners.add(hash);
  return ok;
}

function hex64(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : "";
}

function slugValue(value: unknown) {
  return typeof value === "string" && /^[a-z0-9]{6,24}$/u.test(value) ? value : "";
}

/** A slug or a custom alias: lowercase latin letters, digits and hyphens. */
function linkValue(value: unknown) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{2,39}$/u.test(value) ? value : "";
}

function token32(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value) ? value : "";
}

async function managedSlug(slug: string, token: string) {
  if (!slug || !token) return false;
  const rows = await (await db(`khasroy_invitations?slug=eq.${slug}&manage_token=eq.${token}&${ACTIVE}&select=slug&limit=1`)).json();
  return Array.isArray(rows) && rows.length > 0;
}

function newSlug() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function obj(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function latestForSession(sessionHash: string) {
  const rows = await (await db(
    `khasroy_invitations?session_hash=eq.${sessionHash}&${ACTIVE}&select=${ROW_PRIVATE}&order=updated_at.desc&limit=1`,
  )).json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

Deno.serve(async (request) => {
  if (request.method === "GET") return json({ ok: true, service: "khasroy-invitations", version: 6 });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await request.json().catch(() => ({}));
    const ownerKey = typeof body?.ownerKey === "string" ? body.ownerKey.trim() : "";
    if (!ownerKey) return json({ error: "unauthorized" }, 401);
    const ownerHash = await sha256(ownerKey);
    if (!(await ownerAllowed(ownerHash))) return json({ error: "unauthorized" }, 401);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "by_slug") {
      // Accepts the generated slug or the organizer's custom alias.
      const link = linkValue(body.slug);
      if (!link) return json({ error: "invalid_slug" }, 400);
      const rows = await (await db(`khasroy_invitations?or=(slug.eq.${link},alias.eq.${link})&${ACTIVE}&select=${ROW}&limit=1`)).json();
      return json({ invitation: Array.isArray(rows) && rows[0] ? rows[0] : null });
    }

    if (action === "list") {
      const wanted = (typeof body.status === "string" ? body.status : "submitted").split(",").filter((s: string) => STATUSES.includes(s));
      const statuses = wanted.length ? wanted : ["submitted"];
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 200);
      const rows = await (await db(
        `khasroy_invitations?status=in.(${statuses.join(",")})&select=${ROW_PRIVATE}&order=updated_at.desc&limit=${limit}`,
      )).json();
      return json({ invitations: rows });
    }

    if (action === "set_status") {
      const slug = slugValue(body.slug);
      const status = STATUSES.includes(body.status) ? body.status : "";
      if (!slug || !status) return json({ error: "invalid" }, 400);
      const rows = await (await db(`khasroy_invitations?slug=eq.${slug}&select=${ROW_PRIVATE}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
      })).json();
      return json({ invitation: Array.isArray(rows) && rows[0] ? rows[0] : null });
    }

    if (action === "manage") {
      // The organizer's secret link: slug + token must match; returns the invitation and every answer.
      const slug = slugValue(body.slug);
      const token = typeof body.token === "string" && /^[a-f0-9]{32}$/u.test(body.token) ? body.token : "";
      if (!slug || !token) return json({ error: "not_found" }, 404);
      const rows = await (await db(`khasroy_invitations?slug=eq.${slug}&manage_token=eq.${token}&${ACTIVE}&select=${ROW}&limit=1`)).json();
      if (!Array.isArray(rows) || !rows[0]) return json({ error: "not_found" }, 404);
      const rsvps = await (await db(
        `khasroy_invitation_rsvps?invitation_slug=eq.${slug}&select=guest_name,answer,party_size,created_at&order=created_at.desc&limit=2000`,
      )).json();
      const wishes = await (await db(
        `khasroy_invitation_wishes?invitation_slug=eq.${slug}&select=id,guest_name,text,hidden,created_at&order=created_at.desc&limit=1000`,
      )).json();
      return json({ invitation: rows[0], rsvps, wishes });
    }

    if (action === "set_alias") {
      const slug = slugValue(body.slug);
      const token = token32(body.token);
      const alias = body.alias === "" ? "" : linkValue(body.alias);
      if (body.alias !== "" && !alias) return json({ error: "invalid_alias" }, 400);
      if (!(await managedSlug(slug, token))) return json({ error: "not_found" }, 404);
      if (alias) {
        const taken = await (await db(`khasroy_invitations?or=(slug.eq.${alias},alias.eq.${alias})&slug=neq.${slug}&select=slug&limit=1`)).json();
        if (Array.isArray(taken) && taken.length) return json({ error: "alias_taken" }, 409);
      }
      await db(`khasroy_invitations?slug=eq.${slug}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ alias: alias || null }),
      });
      return json({ ok: true, alias: alias || null });
    }

    if (action === "wish_add") {
      const slug = slugValue(body.slug);
      const clean = (v: unknown, max: number) =>
        typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f]/gu, "").trim().slice(0, max) : "";
      const name = clean(body.name, 80);
      const text = clean(body.text, 500);
      if (!slug || !name || !text) return json({ error: "invalid_wish" }, 400);
      const rows = await (await db(`khasroy_invitations?slug=eq.${slug}&${ACTIVE}&select=slug&limit=1`)).json();
      if (!Array.isArray(rows) || !rows[0]) return json({ error: "not_found" }, 404);
      const countRes = await db(`khasroy_invitation_wishes?invitation_slug=eq.${slug}&select=id`, {
        method: "HEAD",
        headers: { Prefer: "count=exact" },
      });
      const total = Number((countRes.headers.get("content-range") || "").split("/")[1] || 0);
      if (total >= 1000) return json({ error: "wish_limit" }, 429);
      await db("khasroy_invitation_wishes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ invitation_slug: slug, guest_name: name, text }),
      });
      return json({ ok: true });
    }

    if (action === "wishes") {
      const slug = slugValue(body.slug);
      if (!slug) return json({ error: "invalid_slug" }, 400);
      const rows = await (await db(
        `khasroy_invitation_wishes?invitation_slug=eq.${slug}&hidden=eq.false&select=id,guest_name,text,created_at&order=created_at.desc&limit=200`,
      )).json();
      return json({ wishes: rows });
    }

    if (action === "wish_hide") {
      const slug = slugValue(body.slug);
      const token = token32(body.token);
      const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/u.test(body.id) ? body.id : "";
      if (!id || !(await managedSlug(slug, token))) return json({ error: "not_found" }, 404);
      await db(`khasroy_invitation_wishes?id=eq.${id}&invitation_slug=eq.${slug}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ hidden: body.hidden !== false }),
      });
      return json({ ok: true });
    }

    if (action === "rsvp") {
      const slug = slugValue(body.slug);
      const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f]/gu, "").trim().slice(0, 80) : "";
      const answer = ["yes", "family", "no"].includes(body.answer) ? body.answer : "";
      const party = answer === "no" ? 0 : answer === "yes" ? 1 : Math.min(Math.max(Math.round(Number(body.partySize) || 2), 2), 30);
      if (!slug || !name || !answer) return json({ error: "invalid_rsvp" }, 400);
      const rows = await (await db(`khasroy_invitations?slug=eq.${slug}&${ACTIVE}&select=slug&limit=1`)).json();
      if (!Array.isArray(rows) || !rows[0]) return json({ error: "not_found" }, 404);
      const countRes = await db(`khasroy_invitation_rsvps?invitation_slug=eq.${slug}&select=id`, {
        method: "HEAD",
        headers: { Prefer: "count=exact" },
      });
      const total = Number((countRes.headers.get("content-range") || "").split("/")[1] || 0);
      if (total >= 2000) return json({ error: "rsvp_limit" }, 429);
      await db("khasroy_invitation_rsvps", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ invitation_slug: slug, guest_name: name, answer, party_size: party }),
      });
      return json({ ok: true });
    }

    if (action === "rsvps") {
      const slug = slugValue(body.slug);
      if (!slug) return json({ error: "invalid_slug" }, 400);
      const rows = await (await db(
        `khasroy_invitation_rsvps?invitation_slug=eq.${slug}&select=guest_name,answer,party_size,created_at&order=created_at.desc&limit=2000`,
      )).json();
      return json({ rsvps: rows });
    }

    if (action === "sales_lead") {
      const session = hex64(body.sessionHash);
      const clean = (v: unknown, max: number) =>
        typeof v === "string" ? v.replace(/[\u0000-\u001f]/gu, " ").trim().slice(0, max) : "";
      const phone = clean(body.phone, 40);
      if (!session || phone.replace(/\D/gu, "").length < 7) return json({ error: "invalid_lead" }, 400);
      const conversation = (Array.isArray(body.conversation) ? body.conversation.slice(-30) : [])
        .map((t: unknown) => obj(t))
        .filter((t: Record<string, unknown> | null): t is Record<string, unknown> =>
          Boolean(t) && (t!.role === "user" || t!.role === "assistant") && typeof t!.content === "string")
        .map((t: Record<string, unknown>) => ({ role: t.role, content: String(t.content).slice(0, 2000) }));
      await db("khasroy_sales_leads?on_conflict=session_hash,phone", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        // Empty fields are left out so a later message never erases a name given earlier.
        body: JSON.stringify(Object.fromEntries(Object.entries({
          session_hash: session,
          phone,
          name: clean(body.name, 80),
          request: clean(body.request, 300),
          conversation,
          updated_at: new Date().toISOString(),
        }).filter(([, v]) => v !== ""))),
      });
      return json({ ok: true });
    }

    if (action === "sales_leads") {
      const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
      const rows = await (await db(
        `khasroy_sales_leads?select=id,name,phone,request,status,created_at,updated_at,conversation&order=updated_at.desc&limit=${limit}`,
      )).json();
      return json({ leads: rows });
    }

    if (action === "sales_session_get" || action === "sales_session_save") {
      const sid = typeof body.sessionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.sessionId)
        ? body.sessionId : "";
      if (!sid) return json({ error: "invalid_session" }, 400);
      const sessions = await (await db(`khasroy_sales_sessions?session_id=eq.${sid}&select=stage,data,message_count,last_message_at&limit=1`)).json();
      const session = Array.isArray(sessions) && sessions[0] ? sessions[0] : null;

      if (action === "sales_session_get") {
        const limit = Math.min(Math.max(Number(body.limit) || 7, 1), 60);
        const rows = session
          ? await (await db(`khasroy_sales_messages?session_id=eq.${sid}&select=role,content&order=created_at.desc,id.desc&limit=${limit}`)).json()
          : [];
        return json({ session, messages: Array.isArray(rows) ? rows.reverse() : [] });
      }

      const user = typeof body.user === "string" ? body.user.slice(0, 4000) : "";
      const assistant = typeof body.assistant === "string" ? body.assistant.slice(0, 4000) : "";
      const stage = ["greeting", "qualification", "proposal", "closing", "finished"].includes(body.stage) ? body.stage : "greeting";
      const data = obj(body.data) ?? {};
      if (!user || !assistant) return json({ error: "invalid_messages" }, 400);
      const count = Number(session?.message_count || 0);
      if (count >= 400) return json({ error: "session_limit" }, 429);
      const now = new Date().toISOString();
      await db("khasroy_sales_sessions?on_conflict=session_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ session_id: sid, stage, data, message_count: count + 2, last_message_at: now }),
      });
      await db("khasroy_sales_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([
          { session_id: sid, role: "user", content: user },
          { session_id: sid, role: "assistant", content: assistant },
        ]),
      });
      return json({ ok: true });
    }

    const sessionHash = hex64(body.sessionHash);
    if (!sessionHash) return json({ error: "invalid_session" }, 400);

    if (action === "get_session") {
      return json({ invitation: await latestForSession(sessionHash) });
    }

    if (action === "save") {
      const data = obj(body.data);
      if (!data) return json({ error: "invalid_data" }, 400);
      const history = Array.isArray(body.history) ? body.history.slice(-60) : [];
      const patch = {
        data,
        history,
        event_type: typeof data.eventType === "string" ? data.eventType.slice(0, 40) : null,
        template_id: typeof data.templateId === "string" ? data.templateId.slice(0, 40) : null,
        updated_at: new Date().toISOString(),
      };
      const existing = await latestForSession(sessionHash);
      if (existing) {
        const count = Number(existing.message_count || 0) + (body.countMessage ? 1 : 0);
        const rows = await (await db(`khasroy_invitations?id=eq.${existing.id}&select=${ROW_PRIVATE}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...patch, message_count: count }),
        })).json();
        return json({ invitation: rows[0] });
      }
      const rows = await (await db(`khasroy_invitations?select=${ROW_PRIVATE}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...patch,
          owner_hash: ownerHash,
          session_hash: sessionHash,
          slug: newSlug(),
          status: "draft",
          message_count: body.countMessage ? 1 : 0,
        }),
      })).json();
      return json({ invitation: rows[0] });
    }

    if (action === "submit") {
      const existing = await latestForSession(sessionHash);
      if (!existing) return json({ error: "not_found" }, 404);
      const contact = obj(body.contact) ?? {};
      const clean = {
        name: typeof contact.name === "string" ? contact.name.trim().slice(0, 80) : "",
        phone: typeof contact.phone === "string" ? contact.phone.replace(/[^\d+()\-\s]/gu, "").slice(0, 24) : "",
      };
      if (!clean.phone) return json({ error: "phone_required" }, 400);
      const rows = await (await db(`khasroy_invitations?id=eq.${existing.id}&select=${ROW_PRIVATE}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "submitted", contact: clean, updated_at: new Date().toISOString() }),
      })).json();
      return json({ invitation: rows[0] });
    }

    if (action === "upload_photo") {
      const ext = PHOTO_TYPES[typeof body.contentType === "string" ? body.contentType : ""];
      if (!ext) return json({ error: "unsupported_type" }, 400);
      const base64 = typeof body.base64 === "string" ? body.base64 : "";
      if (!base64 || base64.length > Math.ceil(MAX_PHOTO_BYTES * 1.37)) return json({ error: "too_large" }, 413);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_PHOTO_BYTES) return json({ error: "too_large" }, 413);
      const existing = await latestForSession(sessionHash);
      if (!existing) return json({ error: "not_found" }, 404);
      const path = `${existing.slug}/${crypto.randomUUID()}.${ext}`;
      const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": body.contentType },
        body: bytes,
      });
      if (!upload.ok) {
        const text = await upload.text().catch(() => "");
        throw new Error(`storage ${upload.status}: ${text.slice(0, 200)}`);
      }
      return json({ url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("khasroy-invitations", error);
    return json({ error: "invitation_service_unavailable" }, 500);
  }
});
