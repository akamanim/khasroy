import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { listLeads, type StoredLead } from "@/lib/sales/server";
import styles from "../sales.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Заявки консультанта", robots: { index: false, follow: false } };

async function isOwner() {
  const key = process.env.KHASROY_OWNER_KEY?.trim();
  if (!key) return false;
  const session = (await cookies()).get(OWNER_COOKIE)?.value;
  return Boolean(session && safeEqual(session, ownerSessionToken(key)));
}

function when(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function LeadsPage() {
  const owner = await isOwner();
  let leads: StoredLead[] = [];
  let failure = "";
  if (owner) {
    try {
      leads = await listLeads(200);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  return (
    <main className={styles.page} style={{ display: "block", maxWidth: "none", overflowY: "auto" }}>
      <div className={styles.shell} style={{ height: "auto" }}>
        <header className={styles.header}>
          <div>
            <h1>Заявки консультанта</h1>
            <p>{owner ? `Всего: ${leads.length}` : "Только для владельца"}</p>
          </div>
        </header>
        {!owner && <p className={styles.notice}>Войдите в <a href="/owner">консоль владельца</a>, затем откройте эту страницу снова.</p>}
        {failure && <p className={styles.notice}>Не удалось загрузить заявки: {failure}</p>}
        {owner && !failure && leads.length === 0 && <p className={styles.notice}>Пока никто не оставил контакт.</p>}
        <div className={styles.leads}>
          {leads.map((lead) => (
            <article key={lead.id} className={styles.lead}>
              <h2>{lead.name || "Без имени"} · <a href={`tel:${lead.phone.replace(/[^\d+]/gu, "")}`}>{lead.phone}</a></h2>
              {lead.request && <p>{lead.request}</p>}
              <p>{when(lead.updated_at)}</p>
              {lead.conversation.length > 0 && (
                <details>
                  <summary>Переписка</summary>
                  {lead.conversation.map((t, i) => (
                    <p key={i}><b>{t.role === "user" ? "Клиент" : "Консультант"}:</b> {t.content}</p>
                  ))}
                </details>
              )}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
