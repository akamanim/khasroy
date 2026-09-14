import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHANNELS = ["instagram", "tiktok", "telegram"] as const;
const CONTENT_TYPES = ["reel", "post", "story", "carousel"] as const;
const MAX_PUBLISH_ATTEMPTS = 5;
const DEFAULT_STALE_MINUTES = 15;

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

function retryDelaySeconds(attempt: number) {
  return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return json({
      ok: true,
      service: "khasroy-social-store",
      version: 4,
      socialChannels: [...CHANNELS],
      contentTypes: [...CONTENT_TYPES],
      capabilities: ["queue_social", "list_social", "save_composed", "claim_ready", "list_stale_publishing", "mark_published", "mark_failed"],
      publishing: { maxAttempts: MAX_PUBLISH_ATTEMPTS, claimIsCompareAndSet: true, staleReconciliationMinutes: DEFAULT_STALE_MINUTES },
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
            publishAttempts: Number(metadata.publishAttempts) || 0,
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

    if (action === "claim_ready") {
      const now = new Date().toISOString();
      const channel = CHANNELS.includes(body?.channel) ? body.channel : null;
      const channelFilter = channel ? `&channel=eq.${channel}` : "";
      const lookup = await db(`khasroy_social_queue?owner_hash=eq.${ownerHash}&status=eq.ready${channelFilter}&or=(scheduled_at.is.null,scheduled_at.lte.${encodeURIComponent(now)})&select=id,channel,content_type,status,title,caption,script,media_url,metadata,scheduled_at,updated_at&order=scheduled_at.asc.nullsfirst,created_at.asc&limit=1`);
      const rows = await lookup.json();
      const candidate = Array.isArray(rows) ? rows[0] : null;
      if (!candidate?.id) return json({ ok: true, item: null });

      const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
      const attempt = Math.max(0, Number(metadata.publishAttempts) || 0) + 1;
      const response = await db(`khasroy_social_queue?id=eq.${encodeURIComponent(candidate.id)}&owner_hash=eq.${ownerHash}&status=eq.ready`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "publishing",
          last_error: null,
          metadata: { ...metadata, stage: "publishing", publishAttempts: attempt, claimedAt: now },
          updated_at: now,
        }),
      });
      const claimed = await response.json();
      return json({ ok: true, item: Array.isArray(claimed) ? claimed[0] || null : null, attempt });
    }

    if (action === "list_stale_publishing") {
      const staleMinutesRaw = Number(body?.staleMinutes);
      const staleMinutes = Number.isFinite(staleMinutesRaw)
        ? Math.min(1440, Math.max(5, Math.trunc(staleMinutesRaw)))
        : DEFAULT_STALE_MINUTES;
      const limitRaw = Number(body?.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.trunc(limitRaw))) : 5;
      const channel = CHANNELS.includes(body?.channel) ? body.channel : null;
      const channelFilter = channel ? `&channel=eq.${channel}` : "";
      const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
      const response = await db(`khasroy_social_queue?owner_hash=eq.${ownerHash}&status=eq.publishing${channelFilter}&updated_at=lte.${encodeURIComponent(cutoff)}&select=id,channel,content_type,status,title,caption,script,media_url,metadata,scheduled_at,updated_at&order=updated_at.asc&limit=${limit}`);
      return json({ ok: true, staleMinutes, items: await response.json() });
    }

    if (action === "mark_published") {
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      const publishedId = typeof body?.publishedId === "string" ? body.publishedId.trim().slice(0, 500) : "";
      if (!id || !publishedId) return json({ error: "id_and_published_id_required" }, 400);
      const now = new Date().toISOString();
      const response = await db(`khasroy_social_queue?id=eq.${encodeURIComponent(id)}&owner_hash=eq.${ownerHash}&status=eq.publishing`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "published", published_id: publishedId, published_at: now, last_error: null, updated_at: now }),
      });
      const rows = await response.json();
      const item = Array.isArray(rows) ? rows[0] || null : null;
      if (!item) return json({ error: "publish_state_conflict" }, 409);
      return json({ ok: true, item });
    }

    if (action === "mark_failed") {
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      const errorText = typeof body?.error === "string" ? body.error.trim().slice(0, 1000) : "publish_failed";
      const retryable = body?.retryable !== false;
      if (!id) return json({ error: "id_required" }, 400);

      const lookup = await db(`khasroy_social_queue?id=eq.${encodeURIComponent(id)}&owner_hash=eq.${ownerHash}&status=eq.publishing&select=id,metadata&limit=1`);
      const rows = await lookup.json();
      const existing = Array.isArray(rows) ? rows[0] : null;
      if (!existing?.id) return json({ error: "publish_state_conflict" }, 409);
      const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
      const attempt = Math.max(1, Number(metadata.publishAttempts) || 1);
      const terminal = !retryable || attempt >= MAX_PUBLISH_ATTEMPTS;
      const delaySeconds = terminal ? 0 : retryDelaySeconds(attempt);
      const now = new Date();
      const scheduledAt = terminal ? null : new Date(now.getTime() + delaySeconds * 1000).toISOString();
      const response = await db(`khasroy_social_queue?id=eq.${encodeURIComponent(id)}&owner_hash=eq.${ownerHash}&status=eq.publishing`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: terminal ? "failed" : "ready",
          last_error: errorText,
          scheduled_at: scheduledAt,
          metadata: { ...metadata, stage: terminal ? "failed" : "retry_wait", lastPublishError: errorText, retryAt: scheduledAt },
          updated_at: now.toISOString(),
        }),
      });
      const updated = await response.json();
      return json({ ok: true, terminal, retryAfterSeconds: terminal ? null : delaySeconds, item: Array.isArray(updated) ? updated[0] || null : null });
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
