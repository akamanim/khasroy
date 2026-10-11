import { NextResponse } from "next/server";
import { missingFields, type Invitation } from "@/lib/invitations/schema";
import type { ChatTurn, InvitationRecord } from "@/lib/invitations/server";

export const MAX_MESSAGES_PER_SESSION = 150;
export const MAX_MESSAGE_CHARS = 1500;

export function studioPayload(record: InvitationRecord | null, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    slug: record?.slug ?? null,
    status: record?.status ?? null,
    invitation: (record?.data ?? null) as Invitation | null,
    history: (record?.history ?? []) as ChatTurn[],
    missing: record ? missingFields(record.data) : [],
    // After ordering, the organizer gets their secret guest-list link.
    guestsLink: record && record.status !== "draft" && record.manageToken ? `/i/${record.slug}/guests?k=${record.manageToken}` : null,
    ...extra,
  });
}

export function studioError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}
