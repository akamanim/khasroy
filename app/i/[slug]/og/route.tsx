import { ImageResponse } from "next/og";
import { EVENT_LABELS, TEMPLATE_META, displayTitle } from "@/lib/invitations/schema";
import { loadInvitationBySlug } from "@/lib/invitations/server";
import { shareDate } from "@/lib/invitations/share";

export const dynamic = "force-dynamic";

// The picture WhatsApp/Telegram show under an invitation link: names, date, and the couple's
// photo when there is one. 1200×630 is the size the messengers expect.
const SIZE = { width: 1200, height: 630 };

/** Fetches a Cyrillic-capable TTF subset from Google Fonts (satori cannot read woff2). */
async function font(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`,
      { signal: AbortSignal.timeout(5000) },
    )).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/u)?.[1];
    if (!url) return null;
    return await (await fetch(url, { signal: AbortSignal.timeout(5000) })).arrayBuffer();
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await loadInvitationBySlug(slug).catch(() => null);
  if (!record) return new Response("Not found", { status: 404 });
  const inv = record.data;
  const title = displayTitle(inv);
  const subtitle = [EVENT_LABELS[inv.eventType], shareDate(inv)].filter(Boolean).join(" · ");
  const venue = inv.venue.name;
  const photo = inv.photos[0] ?? "";
  const bg = (TEMPLATE_META[inv.templateId] ?? TEMPLATE_META.minimal).pageBg;

  const text = `${title}${subtitle}${venue}Вы приглашены`;
  const [serif, sans] = await Promise.all([font("Cormorant Garamond", 600, text), font("Manrope", 500, text)]);
  const fonts = [
    ...(serif ? [{ name: "Serif", data: serif, weight: 600 as const }] : []),
    ...(sans ? [{ name: "Sans", data: sans, weight: 500 as const }] : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: photo ? "#111" : `linear-gradient(135deg, ${bg}, #1a1410)`,
          color: "#fff",
          fontFamily: "Sans",
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
        ) : null}
        <div
          style={{
            // satori ignores the inset shorthand: size the overlay explicitly.
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "56px 64px",
            background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.72) 100%)",
          }}
        >
          <div style={{ fontSize: 30, letterSpacing: 6, textTransform: "uppercase", opacity: 0.85 }}>Вы приглашены</div>
          <div style={{ fontFamily: "Serif", fontSize: 92, lineHeight: 1.05, marginTop: 10 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 36, marginTop: 18, opacity: 0.95 }}>{subtitle}</div> : null}
          {venue ? <div style={{ fontSize: 28, marginTop: 8, opacity: 0.8 }}>{venue}</div> : null}
        </div>
      </div>
    ),
    { ...SIZE, fonts, headers: { "cache-control": "public, max-age=600, s-maxage=600" } },
  );
}
