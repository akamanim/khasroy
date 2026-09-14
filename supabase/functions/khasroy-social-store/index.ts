import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHANNELS = ["instagram", "tiktok", "telegram"] as const;
const CONTENT_TYPES = ["reel", "post", "story", "carousel"] as const;

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
  if (!response.ok) throw new Error(`db_${response.status}:${(await response.text()).slice(0, 300)}`);
  return response;
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return json({
      ok: true,
      service: "khasroy-social-store",
      version: 2,
      socialChannels: [...CHANNELS],
      contentTypes: [...CONTENT_TYPES],
      capabilities: ["queue_social", "list_social", "save_composed"],
    });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await request.json();
    const ownerKey = typeof body?.ownerKey === "string" ? body.ownerKey.trim() : "";
    if (!ownerKey) return json({ error: "invalid_owner" }, 401);
    const ownerHash = await sha256(ownerKey);
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "queue_social") {
      const channel = CHANNELS.includes(body?.channel) ? body.channel : "";
      const contentType = CONTENT_TYPES.includes(body?.contentType) ? body.contentType : "reel";
      if (!channel) return json({ error: "invalid_channel", supported: CHANNELS }, 400);

      const response = await db("khasroy_social_queue", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          owner_hash: ownerHash,
          channel,
          content_type: contentType,
          status: "draft",
          title: typeof body?.title === "string" ? body.title.slice(0, 300) : null,
          caption: typeof body?.caption === "string" ? body.caption.slice(0, 5000) : null,
          script: typeof body?.script === "string" ? body.script.slice(0, 8000) : null,
          media_url: typeof body?.mediaUrl === "string" ? body.mediaUrl.slice(0, 2000) : null,
          metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
          updated_at: new Date().toISOString(),
        }),
      });
      const rows = await response.json();
      return json({ ok: true, item: Array.isArray(rows) ? rows[0] || null : null });
    }

    if (action === "save_composed") {
      const planItemId = typeof body?.planItemId === "string" ? body.planItemId.trim().slice(0, 500) : "";
      const artifact = body?.artifact && typeof body.artifact === "object" ? body.artifact : null;
      if (!planItemId || !artifact) return json({ error: "plan_item_and_artifact_required" }, 400);

      const lookup = await db(`khasroy_social_queue?owner_hash=eq.${ownerHash}&metadata->>planItemId=eq.${encodeURIComponent(planItemId)}&select=id,metadata&order=created_at.desc&limit=1`);
      const rows = await lookup.json();
      const existing = Array.isArray(rows) ? rows[0] : null;
      if (!existing?.id) return json({ error: "social_item_not_found" }, 404);

      const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
      const quality = body?.quality && typeof body.quality === "object" ? body.quality : {};
      const response = await db(`khasroy_social_queue?id=eq.${encodeURIComponent(existing.id)}&owner_hash=eq.${ownerHash}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "ready",
          title: typeof artifact.title === "string" ? artifact.title.slice(0, 300) : null,
          caption: typeof artifact.caption === "string" ? artifact.caption.slice(0, 5000) : null,
          script: typeof artifact.script === "string" ? artifact.script.slice(0, 8000) : null,
          metadata: {
            ...metadata,
            stage: "ready",
            composer: "deterministic_smm_compose_v1",
            composeQuality: quality,
            hook: typeof artifact.hook === "string" ? artifact.hook.slice(0, 300) : null,
            cta: typeof artifact.cta === "string" ? artifact.cta.slice(0, 300) : null,
            shotList: Array.isArray(artifact.shotList) ? artifact.shotList.slice(0, 20) : [],
            provenance: typeof artifact.provenance === "string" ? artifact.provenance.slice(0, 1000) : null,
          },
          updated_at: new Date().toISOString(),
        }),
      });
      const updated = await response.json();
      return json({ ok: true, item: Array.isArray(updated) ? updated[0] || null : null });
    }

    if (action === "list_social") {
      const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 100);
      const response = await db(`khasroy_social_queue?owner_hash=eq.${ownerHash}&select=id,channel,content_type,status,title,caption,script,media_url,metadata,published_id,last_error,scheduled_at,published_at,created_at,updated_at&order=created_at.desc&limit=${limit}`);
      return json(await response.json());
    }

    return json({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error("khasroy-social-store", error);
    return json({ error: "service_unavailable" }, 500);
  }
});