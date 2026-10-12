// Server side of the reel studio: talks to the khasroy-reels queue (Supabase edge function).

import type { Plan } from "@/lib/reels/catalog";

const ENDPOINT = "https://kebzlrmzbygxwfubnykq.supabase.co/functions/v1/khasroy-reels";

export type ScriptScene = { seconds: number; what: string; text: string };
export type Script = { title: string; idea: string; scenes: ScriptScene[] };

export type ReelJob = {
  id: string;
  status: "draft" | "queued" | "rendering" | "done" | "failed";
  brief: string;
  title: string;
  script: Script | null;
  plan: Plan | null;
  video_url: string | null;
  error: string | null;
  attempts: number;
  queued_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReelListItem = Pick<ReelJob, "id" | "status" | "title" | "video_url" | "error" | "queued_at" | "created_at" | "updated_at">;

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) throw new Error("KHASROY_OWNER_KEY is not configured");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, action, ownerKey }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(`reels ${action} failed: ${response.status} ${data?.error ?? ""}`);
  return data;
}

export async function saveReel(fields: { id?: string; brief?: string; title?: string; script?: Script; plan?: Plan }): Promise<ReelJob> {
  return (await call<{ job: ReelJob }>("save", fields)).job;
}

export async function queueReel(id: string): Promise<ReelJob> {
  return (await call<{ job: ReelJob }>("queue", { id })).job;
}

export async function getReel(id: string): Promise<ReelJob | null> {
  return (await call<{ job: ReelJob | null }>("get", { id })).job;
}

export async function listReels(): Promise<ReelListItem[]> {
  return (await call<{ jobs: ReelListItem[] }>("list")).jobs ?? [];
}
