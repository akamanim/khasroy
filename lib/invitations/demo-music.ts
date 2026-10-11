import type { EventType } from "@/lib/invitations/schema";

/**
 * YouTube links for background music on the public demo pages, per event type.
 * Only use tracks we are allowed to play (own, licensed or royalty-free).
 * KHASROY_DEMO_MUSIC_URL overrides all of them.
 */
export const DEMO_MUSIC: Partial<Record<EventType, string>> = {};
