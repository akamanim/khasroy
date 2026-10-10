import { applyInvitationPatch, emptyInvitation } from "@/lib/invitations/schema";
import { loadSessionInvitation, saveSessionInvitation, sessionHash } from "@/lib/invitations/server";
import { studioError, studioPayload } from "@/lib/invitations/respond";

export const dynamic = "force-dynamic";

/** Applies a direct choice from the template gallery (template, palette or event type). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return studioError("Некорректный запрос.", 400);
  const patch = {
    templateId: body.templateId,
    palette: body.palette,
    eventType: body.eventType,
  };
  try {
    const hash = await sessionHash(true);
    if (!hash) return studioError("Сессия не создана.", 400);
    const record = await loadSessionInvitation(hash);
    if (record && record.status !== "draft") return studioError("Заказ уже оформлен.", 409);
    const next = applyInvitationPatch(record?.data ?? emptyInvitation(), patch);
    const saved = await saveSessionInvitation(hash, next, record?.history ?? [], false);
    return studioPayload(saved);
  } catch (error) {
    console.error("Invite template change failed", error);
    return studioError("Не удалось применить шаблон.");
  }
}
