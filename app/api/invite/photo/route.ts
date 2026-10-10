import { applyInvitationPatch, emptyInvitation } from "@/lib/invitations/schema";
import {
  loadSessionInvitation,
  saveSessionInvitation,
  sessionHash,
  uploadSessionPhoto,
} from "@/lib/invitations/server";
import { studioError, studioPayload } from "@/lib/invitations/respond";

export const dynamic = "force-dynamic";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64 = 7_000_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { contentType?: unknown; base64?: unknown } | null;
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const base64 = typeof body?.base64 === "string" ? body.base64 : "";
  if (!TYPES.has(contentType)) return studioError("Поддерживаются фото JPEG, PNG и WebP.", 400);
  if (!base64 || base64.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/u.test(base64)) {
    return studioError("Фото слишком большое или повреждено.", 413);
  }
  try {
    const hash = await sessionHash(true);
    if (!hash) return studioError("Сессия не создана.", 400);
    let record = await loadSessionInvitation(hash);
    if (record && record.status !== "draft") return studioError("Заказ уже оформлен.", 409);
    if (!record) record = await saveSessionInvitation(hash, emptyInvitation(), [], false);
    if (record.data.photos.length >= 8) return studioError("Можно добавить до 8 фото.", 400);
    const url = await uploadSessionPhoto(hash, contentType, base64);
    const next = applyInvitationPatch(record.data, { photos: [...record.data.photos, url] });
    const saved = await saveSessionInvitation(hash, next, record.history, false);
    return studioPayload(saved, { photoUrl: url });
  } catch (error) {
    console.error("Invite photo upload failed", error);
    return studioError("Не удалось загрузить фото.");
  }
}
