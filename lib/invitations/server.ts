import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { applyInvitationPatch, emptyInvitation, type Invitation } from "@/lib/invitations/schema";

const ENDPOINT = "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-invitations";
const SESSION_COOKIE = "kh_invite_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type InvitationRecord = {
  slug: string;
  status: "draft" | "submitted" | "approved" | "published" | "archived";
  data: Invitation;
  history: ChatTurn[];
  messageCount: number;
  /** Secret for the organizer's guest-list link; present only on the organizer's own rows. */
  manageToken?: string;
  contact?: { name: string; phone: string };
  createdAt?: string;
  updatedAt?: string;
};

type RawRow = {
  slug: string;
  status: InvitationRecord["status"];
  data: unknown;
  history: unknown;
  message_count: number;
  manage_token?: string;
  contact?: unknown;
  created_at?: string;
  updated_at?: string;
};

function ownerKey(): string {
  const key = process.env.KHASROY_OWNER_KEY?.trim();
  if (!key) throw new Error("KHASROY_OWNER_KEY is not configured");
  return key;
}

function normalize(row: RawRow | null | undefined): InvitationRecord | null {
  if (!row) return null;
  const history = Array.isArray(row.history)
    ? row.history
        .filter((t): t is ChatTurn =>
          Boolean(t) && typeof t === "object" &&
          ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
          typeof (t as ChatTurn).content === "string")
        .slice(-60)
    : [];
  return {
    slug: row.slug,
    status: row.status,
    data: applyInvitationPatch(emptyInvitation(), row.data),
    history,
    messageCount: Number(row.message_count) || 0,
    ...(typeof row.manage_token === "string" ? { manageToken: row.manage_token } : {}),
    ...(row.contact && typeof row.contact === "object"
      ? {
          contact: {
            name: String((row.contact as Record<string, unknown>).name ?? ""),
            phone: String((row.contact as Record<string, unknown>).phone ?? ""),
          },
        }
      : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, action, ownerKey: ownerKey() }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`invitations ${action} failed: ${response.status} ${data?.error ?? ""}`);
  return data;
}

/** Returns the anonymous client session hash, creating the cookie when needed. */
export async function sessionHash(create = true): Promise<string | null> {
  const store = await cookies();
  let token = store.get(SESSION_COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{64}$/u.test(token)) {
    if (!create) return null;
    token = randomBytes(32).toString("hex");
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
  }
  return createHash("sha256").update(token).digest("hex");
}

export async function loadSessionInvitation(hash: string): Promise<InvitationRecord | null> {
  const result = await call<{ invitation: RawRow | null }>("get_session", { sessionHash: hash });
  return normalize(result.invitation);
}

export async function saveSessionInvitation(
  hash: string,
  data: Invitation,
  history: ChatTurn[],
  countMessage: boolean,
): Promise<InvitationRecord> {
  const result = await call<{ invitation: RawRow }>("save", {
    sessionHash: hash,
    data,
    history: history.slice(-60),
    countMessage,
  });
  const record = normalize(result.invitation);
  if (!record) throw new Error("invitation save returned no row");
  return record;
}

export async function loadInvitationBySlug(slug: string): Promise<InvitationRecord | null> {
  if (!/^[a-z0-9]{6,24}$/u.test(slug)) return null;
  const result = await call<{ invitation: RawRow | null }>("by_slug", { slug });
  return normalize(result.invitation);
}

export async function submitSessionInvitation(
  hash: string,
  contact: { name: string; phone: string },
): Promise<InvitationRecord | null> {
  const result = await call<{ invitation: RawRow | null }>("submit", { sessionHash: hash, contact });
  return normalize(result.invitation);
}

export async function uploadSessionPhoto(
  hash: string,
  contentType: string,
  base64: string,
): Promise<string> {
  const result = await call<{ url: string }>("upload_photo", { sessionHash: hash, contentType, base64 });
  return result.url;
}

export type RsvpAnswer = "yes" | "family" | "no";

export type Rsvp = { guest_name: string; answer: RsvpAnswer; party_size: number; created_at: string };

export class NotFoundError extends Error {}

export async function addRsvp(slug: string, name: string, answer: RsvpAnswer, partySize = 1): Promise<void> {
  if (!/^[a-z0-9]{6,24}$/u.test(slug)) throw new NotFoundError("invalid slug");
  try {
    await call<{ ok: boolean }>("rsvp", { slug, name, answer, partySize });
  } catch (error) {
    if (error instanceof Error && / 404 /u.test(error.message)) throw new NotFoundError("invitation not found");
    throw error;
  }
}

export async function listRsvps(slug: string): Promise<Rsvp[]> {
  if (!/^[a-z0-9]{6,24}$/u.test(slug)) return [];
  const result = await call<{ rsvps: Rsvp[] }>("rsvps", { slug });
  return result.rsvps ?? [];
}

/** The organizer's view: invitation + all answers, only with the matching secret token. */
export async function loadManagedInvitation(slug: string, token: string): Promise<{ record: InvitationRecord; rsvps: Rsvp[] } | null> {
  if (!/^[a-z0-9]{6,24}$/u.test(slug) || !/^[a-f0-9]{32}$/u.test(token)) return null;
  try {
    const result = await call<{ invitation: RawRow | null; rsvps: Rsvp[] }>("manage", { slug, token });
    const record = normalize(result.invitation);
    return record ? { record, rsvps: result.rsvps ?? [] } : null;
  } catch (error) {
    if (error instanceof Error && / 404 /u.test(error.message)) return null;
    throw error;
  }
}

export async function listOrders(): Promise<InvitationRecord[]> {
  const result = await call<{ invitations: RawRow[] }>("list", { status: "submitted,approved,published", limit: 200 });
  return (result.invitations ?? []).map((row) => normalize(row)).filter((r): r is InvitationRecord => Boolean(r));
}

export async function setOrderStatus(slug: string, status: "submitted" | "approved" | "published" | "archived") {
  await call("set_status", { slug, status });
}
