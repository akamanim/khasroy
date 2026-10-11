import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvitationView } from "@/components/invitations/invitation-view";
import {
  EVENT_TYPES,
  TEMPLATE_IDS,
  TEMPLATE_META,
  demoInvitation,
  type EventType,
  type TemplateId,
} from "@/lib/invitations/schema";
import { DEMO_MUSIC } from "@/lib/invitations/demo-music";

type Props = {
  params: Promise<{ template: string }>;
  searchParams: Promise<{ event?: string }>;
};

function pick<T extends string>(value: string | undefined, options: readonly T[], fallback: T): T {
  return value && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { template } = await params;
  const meta = TEMPLATE_META[template as TemplateId];
  return {
    title: meta ? `Пример: ${meta.name}` : "Пример приглашения",
    robots: { index: false, follow: false },
  };
}

export default async function DemoPage({ params, searchParams }: Props) {
  const { template } = await params;
  if (!(TEMPLATE_IDS as readonly string[]).includes(template)) notFound();
  const id = template as TemplateId;
  const meta = TEMPLATE_META[id];
  const { event } = await searchParams;
  const eventType = pick<EventType>(event, EVENT_TYPES, meta.events[0]);
  const invitation = demoInvitation(id, eventType, process.env.KHASROY_DEMO_MUSIC_URL || DEMO_MUSIC[eventType] || "");

  return (
    <main
      style={{
        display: "block",
        maxWidth: "none",
        height: "100dvh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        background: meta.pageBg,
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "10px 14px",
          background: "rgba(10, 12, 20, .82)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          color: "#f1f3f8",
          font: "500 13px/1.3 Manrope, system-ui, sans-serif",
        }}
      >
        <span>Пример шаблона «{meta.name}»</span>
        <a
          href={`/?template=${id}`}
          style={{ padding: "8px 14px", borderRadius: 999, background: "#9fd0ff", color: "#06101e", textDecoration: "none", fontWeight: 600 }}
        >
          Создать такое
        </a>
      </div>
      <InvitationView invitation={invitation} demo />
    </main>
  );
}
