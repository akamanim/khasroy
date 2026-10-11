import { runInvitationAgent } from "@/lib/invitations/agent";
import { emptyInvitation } from "@/lib/invitations/schema";
import {
  loadSessionInvitation,
  saveSessionInvitation,
  sessionHash,
  type ChatTurn,
} from "@/lib/invitations/server";
import {
  MAX_MESSAGES_PER_SESSION,
  MAX_MESSAGE_CHARS,
  studioError,
  studioPayload,
} from "@/lib/invitations/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message) return studioError("Напишите сообщение.", 400);

  try {
    const hash = await sessionHash(true);
    if (!hash) return studioError("Сессия не создана.", 400);
    const record = await loadSessionInvitation(hash);
    if (record && record.messageCount >= MAX_MESSAGES_PER_SESSION) {
      return studioError("Достигнут лимит сообщений для этого заказа. Оформите заказ, и мы свяжемся с вами.", 429);
    }
    // Ordered invitations stay editable: clients often change the time or venue later.

    const current = record?.data ?? emptyInvitation();
    const history: ChatTurn[] = record?.history ?? [];
    const result = await runInvitationAgent(current, history, message, Boolean(record && record.status !== "draft"));
    const nextHistory: ChatTurn[] = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: result.reply },
    ];
    const saved = await saveSessionInvitation(hash, result.invitation, nextHistory, true);
    return studioPayload(saved, { reply: result.reply, changed: result.changed });
  } catch (error) {
    console.error("Invite chat failed", error);
    return studioError("Хасрой сейчас не отвечает. Попробуйте ещё раз через минуту.", 502);
  }
}
