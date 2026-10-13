import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Reel job queue. Two kinds of callers:
//  - the Khasroy server (owner key): saves scripts and plans, queues a render, reads jobs;
//  - the GitHub render workflow: proves who it is with a GitHub Actions OIDC token (no shared
//    secret anywhere), claims the next queued job, gets a signed upload URL, reports the result.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "reels";
const REPOSITORY = "akamanim/khasroy";
const WORKFLOW = `${REPOSITORY}/.github/workflows/reel-render.yml@refs/heads/main`;
const AUDIENCE = "khasroy-reels";
const ROW = "id,status,brief,title,script,plan,video_url,error,attempts,queued_at,claimed_at,created_at,updated_at";
const LIST_ROW = "id,status,title,video_url,error,queued_at,created_at,updated_at";

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

const knownOwners = new Set<string>();
async function ownerAllowed(hash: string) {
  if (knownOwners.has(hash)) return true;
  const rows = await (await db(`khasroy_skills?owner_hash=eq.${hash}&select=owner_hash&limit=1`)).json();
  const ok = Array.isArray(rows) && rows.length > 0;
  if (ok) knownOwners.add(hash);
  return ok;
}

const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/iu.test(v) ? v : "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// ---------- GitHub Actions OIDC ----------
function b64url(input: string): Uint8Array {
  const s = input.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

let jwksCache: { at: number; keys: Array<Record<string, unknown>> } | null = null;
async function githubKeys() {
  if (jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const keys = ((await res.json()) as { keys: Array<Record<string, unknown>> }).keys;
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** True only for a fresh token minted for the reel workflow on main of this repository. */
async function runnerAllowed(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (header.alg !== "RS256") return false;
    const jwk = (await githubKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Math.floor(Date.now() / 1000);
    return ok &&
      claims.iss === "https://token.actions.githubusercontent.com" &&
      claims.aud === AUDIENCE &&
      claims.repository === REPOSITORY &&
      claims.ref === "refs/heads/main" &&
      claims.job_workflow_ref === WORKFLOW &&
      typeof claims.exp === "number" && claims.exp > now &&
      typeof claims.iat === "number" && claims.iat < now + 60;
  } catch {
    return false;
  }
}

async function runner(action: string, body: Record<string, unknown>) {
  if (action === "claim") {
    // Jobs stuck in "rendering" for 30 minutes (a cancelled run) go back to the queue, up to 3 tries.
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const candidates = await (await db(
      `khasroy_reel_jobs?or=(status.eq.queued,and(status.eq.rendering,claimed_at.lt."${stale}"))&attempts=lt.3&select=id,plan,attempts,status,claimed_at&order=queued_at.asc&limit=1`,
    )).json();
    const job = Array.isArray(candidates) ? candidates[0] : null;
    if (!job) return json({ job: null });
    // Claim only if nobody took it in the meantime.
    const guard = job.status === "queued" ? "status=eq.queued" : `claimed_at=eq.${encodeURIComponent(job.claimed_at)}`;
    const rows = await (await db(`khasroy_reel_jobs?id=eq.${job.id}&${guard}&select=id,plan`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "rendering", claimed_at: new Date().toISOString(), attempts: job.attempts + 1, updated_at: new Date().toISOString() }),
    })).json();
    return json({ job: Array.isArray(rows) && rows[0] ? rows[0] : null });
  }

  const id = uuid(body.id);
  if (!id) return json({ error: "bad_id" }, 400);

  if (action === "upload_url") {
    const path = `${id}.mp4`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", "x-upsert": "true" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const signed = (await res.json()) as { url: string };
    return json({ uploadUrl: `${SUPABASE_URL}/storage/v1${signed.url}`, publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` });
  }

  if (action === "finish") {
    const ok = body.ok === true;
    const patch = ok
      ? { status: "done", video_url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${id}.mp4?v=${Date.now()}`, error: null }
      : { status: "failed", error: text(body.error, 500) || "сборка не удалась" };
    await db(`khasroy_reel_jobs?id=eq.${id}&status=eq.rendering`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    return json({ ok: true });
  }
  return json({ error: "unknown_action" }, 400);
}

async function owner(action: string, body: Record<string, unknown>, ownerHash: string) {
  if (action === "save") {
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.brief === "string") fields.brief = text(body.brief, 2000);
    if (typeof body.title === "string") fields.title = text(body.title, 120);
    if (body.script && typeof body.script === "object") fields.script = body.script;
    if (body.plan && typeof body.plan === "object") fields.plan = body.plan;
    const id = uuid(body.id);
    if (id) {
      // A job that is rendering or done keeps its plan; editing makes a new draft instead.
      const rows = await (await db(`khasroy_reel_jobs?id=eq.${id}&owner_hash=eq.${ownerHash}&status=in.(draft,failed)&select=${ROW}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...fields, status: "draft", error: null }),
      })).json();
      if (Array.isArray(rows) && rows[0]) return json({ job: rows[0] });
    }
    const rows = await (await db(`khasroy_reel_jobs?select=${ROW}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...fields, owner_hash: ownerHash, status: "draft" }),
    })).json();
    return json({ job: rows[0] });
  }

  if (action === "queue") {
    const id = uuid(body.id);
    if (!id) return json({ error: "bad_id" }, 400);
    const rows = await (await db(`khasroy_reel_jobs?id=eq.${id}&owner_hash=eq.${ownerHash}&plan=not.is.null&status=in.(draft,failed,done)&select=${ROW}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "queued", queued_at: new Date().toISOString(), attempts: 0, error: null, updated_at: new Date().toISOString() }),
    })).json();
    if (!Array.isArray(rows) || !rows[0]) return json({ error: "not_queueable" }, 409);
    return json({ job: rows[0] });
  }

  if (action === "get") {
    const id = uuid(body.id);
    if (!id) return json({ error: "bad_id" }, 400);
    const rows = await (await db(`khasroy_reel_jobs?id=eq.${id}&owner_hash=eq.${ownerHash}&select=${ROW}&limit=1`)).json();
    return json({ job: Array.isArray(rows) && rows[0] ? rows[0] : null });
  }

  // Own material for reels: screenshots, product photos, a logo, a music track.
  // The browser uploads straight to storage with a one-time signed URL; files live under the owner's folder.
  if (action === "asset_url") {
    const types: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
    };
    const ext = text(body.ext, 5).toLowerCase();
    if (!types[ext]) return json({ error: "bad_type" }, 400);
    const kind = types[ext].startsWith("audio") ? "audio" : "image";
    const name = text(body.name, 60).replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || kind;
    const path = `assets/${ownerHash.slice(0, 16)}/${kind}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext === "jpeg" ? "jpg" : ext}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`sign ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const signed = (await res.json()) as { url: string };
    return json({ uploadUrl: `${SUPABASE_URL}/storage/v1${signed.url}`, publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`, kind, name, contentType: types[ext] });
  }

  if (action === "assets") {
    const out: Array<{ url: string; kind: string; name: string; created_at: string }> = [];
    for (const kind of ["image", "audio"]) {
      const prefix = `assets/${ownerHash.slice(0, 16)}/${kind}`;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 60, sortBy: { column: "created_at", order: "desc" } }),
      });
      if (!res.ok) continue;
      const files = (await res.json()) as Array<{ name: string; created_at: string; id: string | null }>;
      for (const f of files) {
        if (!f.id) continue;
        out.push({ url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${prefix}/${f.name}`, kind, name: f.name, created_at: f.created_at });
      }
    }
    return json({ assets: out });
  }

  if (action === "list") {
    const rows = await (await db(`khasroy_reel_jobs?owner_hash=eq.${ownerHash}&select=${LIST_ROW}&order=updated_at.desc&limit=20`)).json();
    return json({ jobs: rows });
  }
  return json({ error: "unknown_action" }, 400);
}

Deno.serve(async (request) => {
  if (request.method === "GET") return json({ ok: true, service: "khasroy-reels", version: 2 });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    if (["claim", "upload_url", "finish"].includes(action)) {
      if (!(await runnerAllowed(request))) return json({ error: "unauthorized" }, 401);
      return await runner(action, body);
    }
    const ownerKey = typeof body.ownerKey === "string" ? body.ownerKey.trim() : "";
    if (!ownerKey) return json({ error: "unauthorized" }, 401);
    const ownerHash = await sha256(ownerKey);
    if (!(await ownerAllowed(ownerHash))) return json({ error: "unauthorized" }, 401);
    return await owner(action, body, ownerHash);
  } catch (error) {
    console.error("khasroy-reels", error);
    return json({ error: "reels_service_unavailable" }, 500);
  }
});
