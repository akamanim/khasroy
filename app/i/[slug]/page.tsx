import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationView } from "@/components/invitations/invitation-view";
import { TEMPLATE_META } from "@/lib/invitations/schema";
import { loadInvitationBySlug } from "@/lib/invitations/server";
import { PUBLIC_ORIGIN, guestName, shareDescription, shareTitle } from "@/lib/invitations/share";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ to?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const guest = guestName((await searchParams).to);
  const record = await loadInvitationBySlug(slug).catch(() => null);
  if (!record) return { title: "Приглашение", robots: { index: false, follow: false } };
  const title = shareTitle(record.data, guest);
  const description = shareDescription(record.data);
  const image = `${PUBLIC_ORIGIN}/i/${slug}/og`;
  return {
    metadataBase: new URL(PUBLIC_ORIGIN),
    title,
    description,
    robots: { index: false, follow: false },
    // What WhatsApp and Telegram show under the link.
    openGraph: {
      type: "website",
      title,
      description,
      url: `/i/${slug}`,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function InvitationPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const guest = guestName((await searchParams).to);
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
        background: (TEMPLATE_META[record.data.templateId] ?? TEMPLATE_META.minimal).pageBg,
      }}
    >
      <InvitationView invitation={record.data} slug={record.slug} guest={guest} />
    </main>
  );
}
