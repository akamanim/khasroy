import { loadSessionInvitation, sessionHash } from "@/lib/invitations/server";
import { studioError, studioPayload } from "@/lib/invitations/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const hash = await sessionHash(true);
    if (!hash) return studioPayload(null);
    return studioPayload(await loadSessionInvitation(hash));
  } catch (error) {
    console.error("Invite session load failed", error);
    return studioError("Не удалось загрузить заказ. Попробуйте обновить страницу.");
  }
}
