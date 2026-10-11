import { loadInvitationBySlug } from "@/lib/invitations/server";
import { PUBLIC_ORIGIN } from "@/lib/invitations/share";
import { qrSvg } from "@/lib/qr";

export const dynamic = "force-dynamic";

/** QR code for printing: points to the short link (alias) when there is one. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await loadInvitationBySlug(slug).catch(() => null);
  if (!record) return new Response("Not found", { status: 404 });
  const link = `${PUBLIC_ORIGIN}/i/${record.alias ?? record.slug}`;
  const download = new URL(request.url).searchParams.has("download");
  return new Response(qrSvg(link, { size: 1024 }), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
      ...(download ? { "content-disposition": `attachment; filename="qr-${record.alias ?? record.slug}.svg"` } : {}),
    },
  });
}
