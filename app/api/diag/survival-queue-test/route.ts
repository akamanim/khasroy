import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken } from "@/lib/server-auth";
import { getPendingTasks, queueTask, updateTask } from "@/lib/server-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPECTED_TOKEN_HASH = "5b48267f8c0399a5cd4784c71eca1ae3964d75f22244884be9fc0105b71fa6ed";

function validToken(value: string) {
  const actual = Buffer.from(createHash("sha256").update(value).digest("hex"));
  const expected = Buffer.from(EXPECTED_TOKEN_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!validToken(url.searchParams.get("token") || "")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() || "";
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_key_missing" }, { status: 503 });
  }

  const chatResponse = await fetch(`${url.origin}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${OWNER_COOKIE}=${ownerSessionToken(ownerKey)}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Хасрой" }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const chatData = (await chatResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  const marker = `survival_queue_probe_${Date.now()}`;
  const task = await queueTask(ownerKey, {
    kind: "diagnostic",
    priority: 1,
    input: { marker },
    checkpoint: { stage: "created_by_production_probe" },
  });

  if (!task?.id) {
    return NextResponse.json(
      {
        ok: false,
        chat: {
          status: chatResponse.status,
          content: typeof chatData?.content === "string" ? chatData.content : null,
        },
        queue: { created: false },
      },
      { status: 500 },
    );
  }

  const pending = await getPendingTasks(ownerKey, 100);
  const found = pending.find((item) => item.id === task.id) || null;

  await updateTask(ownerKey, task.id, {
    status: "cancelled",
    attempts: 1,
    checkpoint: {
      stage: "production_probe_complete",
      verifiedReadable: Boolean(found),
      marker,
    },
  });

  return NextResponse.json({
    ok: chatResponse.ok && Boolean(chatData?.content) && Boolean(found),
    chat: {
      status: chatResponse.status,
      content: typeof chatData?.content === "string" ? chatData.content : null,
      provider: typeof chatData?.provider === "string" ? chatData.provider : null,
      model: typeof chatData?.model === "string" ? chatData.model : null,
      brainMode: typeof chatData?.brainMode === "string" ? chatData.brainMode : null,
    },
    queue: {
      created: true,
      taskId: task.id,
      readable: Boolean(found),
      initialStatus: task.status,
      cleanupStatus: "cancelled",
      marker,
    },
  });
}
