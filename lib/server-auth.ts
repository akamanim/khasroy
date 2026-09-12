import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { installProviderFailover } from "@/lib/ai/provider-failover";
import { installGroqContentGuard } from "@/lib/ai/groq-content-guard";

installProviderFailover();
installGroqContentGuard();

export const OWNER_COOKIE = "khasroy_owner";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function safeEqual(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

export function ownerSessionToken(secret: string) {
  return createHmac("sha256", secret)
    .update("khasroy-owner-session-v1")
    .digest("hex");
}
