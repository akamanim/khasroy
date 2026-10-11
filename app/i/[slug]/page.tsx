import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationView } from "@/components/invitations/invitation-view";
import { displayTitle, type Palette } from "@/lib/invitations/schema";
import { loadInvitationBySlug } from "@/lib/invitations/server";

export const dynamic = "force-dynamic";

const PAGE_BG: Record<Palette, string> = {
  ivory: "#efe8dd",
  blush: "#f0dfdb",
  sage: "#e2e7dd",
  sky: "#e1eaf4",
  night: "#0a0f1b",
  gold: "#130f0b",
};

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const record = await loadInvitationBySlug(slug).catch(() => null);
  return {
    title: record ? displayTitle(record.data) : "Приглашение",
    robots: { index: false, follow: false },
  };
}

export default async function InvitationPage({ params }: Params) {
  const { slug } = await params;
  const record = await loadInvitationBySlug(slug).catch(() => null);
  if (!record) notFound();
  return (
    // Global CSS turns every <main> into the owner console's grid; reset that here.
    <main
      style={{
        display: "block",
        maxWidth: "none",
        height: "100dvh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background: PAGE_BG[record.data.palette],
      }}
    >
      <InvitationView invitation={record.data} />
    </main>
  );
}
