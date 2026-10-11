import type { Metadata } from "next";
import { displayTitle, EVENT_LABELS, TEMPLATE_META } from "@/lib/invitations/schema";
import { listOrders, type InvitationRecord } from "@/lib/invitations/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { shareDate } from "@/lib/invitations/share";
import { StatusButtons } from "./status-buttons";
import styles from "./orders.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Заказы приглашений", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = { submitted: "Новый", approved: "Оплачен", published: "Опубликован" };

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

export default async function OrdersPage() {
  const owner = await isOwnerRequest();
  let orders: InvitationRecord[] = [];
  let failure = "";
  if (owner) {
    try {
      orders = await listOrders();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  const counts = { submitted: 0, approved: 0, published: 0 } as Record<string, number>;
  for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;

  return (
    <main className={styles.page} style={{ display: "block", maxWidth: "none" }}>
      <div className={styles.shell}>
        <header>
          <h1>Заказы приглашений</h1>
          {owner ? (
            <p className={styles.muted}>Новых: {counts.submitted} · оплачено: {counts.approved} · опубликовано: {counts.published}</p>
          ) : null}
        </header>
        {!owner ? <p className={styles.notice}>Войдите в <a href="/owner">консоль владельца</a>, затем откройте эту страницу снова.</p> : null}
        {failure ? <p className={styles.notice}>Не удалось загрузить заказы: {failure}</p> : null}
        {owner && !failure && orders.length === 0 ? <p className={styles.notice}>Заказов пока нет.</p> : null}
        <div className={styles.list}>
          {orders.map((o) => {
            const inv = o.data;
            const phone = o.contact?.phone ?? "";
            return (
              <article key={o.slug} className={styles.order}>
                <div className={styles.top}>
                  <span className={`${styles.badge} ${styles[o.status] ?? ""}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                  <span className={styles.muted}>{when(o.updatedAt)}</span>
                </div>
                <h2>{displayTitle(inv)}</h2>
                <p className={styles.muted}>
                  {[EVENT_LABELS[inv.eventType], shareDate(inv), inv.venue.name, TEMPLATE_META[inv.templateId]?.name].filter(Boolean).join(" · ")}
                </p>
                <p>
                  {o.contact?.name || "Без имени"}
                  {phone ? <> · <a href={`tel:${phone.replace(/[^\d+]/gu, "")}`}>{phone}</a> · <a href={`https://wa.me/${phone.replace(/\D/gu, "")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></> : null}
                </p>
                <p className={styles.links}>
                  <a href={`/i/${o.slug}`} target="_blank" rel="noopener noreferrer">Приглашение</a>
                  {o.manageToken ? <a href={`/i/${o.slug}/guests?k=${o.manageToken}`} target="_blank" rel="noopener noreferrer">Гости</a> : null}
                </p>
                <StatusButtons slug={o.slug} status={o.status} />
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
