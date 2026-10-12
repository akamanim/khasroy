import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { getQueuedTask } from "@/lib/invitations/server";
import { recoverPendingTasks } from "@/lib/survival/recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PENDING = new Set(["waiting_for_compute", "queued"]);

/**
 * The owner console follows a chat task that waits for model limits. While the page is open it
 * also nudges the recovery worker once the task is due, so the answer arrives without waiting for
 * the 10-minute background heartbeat.
 */
export async function GET(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Только для владельца" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let task = await getQueuedTask(id).catch(() => null);
  if (!task) return NextResponse.json({ status: "missing" });

  if (PENDING.has(task.status) && Date.parse(task.available_at) <= Date.now()) {
    const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
    if (ownerKey) {
      await recoverPendingTasks(ownerKey, 1).catch((error) => console.error("Khasroy task nudge failed", error));
      task = (await getQueuedTask(id).catch(() => null)) ?? task;
    }
  }

  const checkpoint = task.checkpoint ?? {};
  const result = typeof checkpoint.result === "string" ? checkpoint.result : typeof checkpoint.resultPreview === "string" ? checkpoint.resultPreview : "";
  return NextResponse.json({
    status: task.status,
    attempts: task.attempts,
    nextAttemptAt: PENDING.has(task.status) ? task.available_at : null,
    reason: typeof checkpoint.lastReason === "string" ? checkpoint.lastReason.slice(0, 200) : "",
    result: task.status === "completed" ? result : "",
  });
}
