import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Lead, SalesTurn } from "@/lib/sales/agent";

const ENDPOINT = "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-invitations";
const COOKIE = "kh_sales_session";

function ownerKey(): string {
  const key = process.env.KHASROY_OWNER_KEY?.trim();
  if (!key) throw new Error("KHASROY_OWNER_KEY is not configured");
  return key;
}

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, action, ownerKey: ownerKey() }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`sales ${action} failed: ${response.status} ${data?.error ?? ""}`);
  return data;
}

/** Anonymous visitor id (hashed), so one visitor's repeated contact updates a single lead. */
export async function salesSession(): Promise<string> {
  const store = await cookies();
  let token = store.get(COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{64}$/u.test(token)) {
    token = randomBytes(32).toString("hex");
    store.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  return createHash("sha256").update(token).digest("hex");
}

export async function saveLead(sessionHash: string, lead: Lead, conversation: SalesTurn[]) {
  await call("sales_lead", { sessionHash, ...lead, conversation: conversation.slice(-30) });
}

export type StoredLead = {
  id: string;
  name: string;
  phone: string;
  request: string;
  status: string;
  created_at: string;
  updated_at: string;
  conversation: SalesTurn[];
};

export async function listLeads(limit = 100): Promise<StoredLead[]> {
  const data = await call<{ leads?: StoredLead[] }>("sales_leads", { limit });
  return data.leads ?? [];
}
