import { missingFields } from "@/lib/invitations/schema";
import { loadSessionInvitation, sessionHash, submitSessionInvitation } from "@/lib/invitations/server";
import { studioError, studioPayload } from "@/lib/invitations/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown; phone?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const phone = typeof body?.phone === "string" ? body.phone.replace(/[^\d+()\-\s]/gu, "").slice(0, 24) : "";
  if (phone.replace(/\D/gu, "").length < 9) return studioError("Укажите номер телефона для связи.", 400);
  try {
    const hash = await sessionHash(false);
    if (!hash) return studioError("Заказ не найден.", 404);
    const record = await loadSessionInvitation(hash);
    if (!record) return studioError("Заказ не найден.", 404);
    const missing = missingFields(record.data);
    if (missing.length) return studioError(`Не хватает: ${missing.join(", ")}.`, 400);
    const saved = await submitSessionInvitation(hash, { name, phone });
    return studioPayload(saved);
  } catch (error) {
    console.error("Invite submit failed", error);
    return studioError("Не удалось оформить заказ.");
  }
}
