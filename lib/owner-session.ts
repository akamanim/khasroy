import { cookies } from "next/headers";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";

/** True when the request carries the owner console's session cookie. */
export async function isOwnerRequest(): Promise<boolean> {
  const key = process.env.KHASROY_OWNER_KEY?.trim();
  if (!key) return false;
  const session = (await cookies()).get(OWNER_COOKIE)?.value;
  return Boolean(session && safeEqual(session, ownerSessionToken(key)));
}
