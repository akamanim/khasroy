import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { displayTitle } from "@/lib/invitations/schema";
import { ANSWER_LABEL, summarizeGuests } from "@/lib/invitations/guests";
import { loadManagedInvitation } from "@/lib/invitations/server";
import { PUBLIC_ORIGIN, shareDate } from "@/lib/invitations/share";
import { ShortLink, WishesAdmin } from "./organizer-tools";
import { PersonalLinks } from "./personal-links";
import styles from "./guests.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Список гостей", robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string }> };

function when(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The organizer's secret page: who answered, how many people are coming, personal links. */
export default async function GuestsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const token = (await searchParams).k ?? "";
  const managed = await loadManagedInvitation(slug, token);
  if (!managed) notFound();
  const inv = managed.record.data;
  const summary = summarizeGuests(managed.rsvps);
  const exportHref = `/i/${slug}/guests/export?k=${token}`;
  const link = managed.record.alias ?? slug;

  return (
    <main className={styles.page} style={{ display: "block", maxWidth: "none" }}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <p className={styles.kicker}>Список гостей</p>
          <h1>{displayTitle(inv)}</h1>
          <p className={styles.muted}>{[shareDate(inv), inv.venue.name].filter(Boolean).join(" · ")}</p>
          <p className={styles.muted}>
            Приглашение: <a href={`/i/${link}`} target="_blank" rel="noopener noreferrer">{`${PUBLIC_ORIGIN.replace(/^https:\/\//u, "")}/i/${link}`}</a>
          </p>
        </header>

        <section className={styles.stats} aria-label="Итоги">
          <div><b>{summary.people}</b><span>человек придут</span></div>
          <div><b>{summary.coming}</b><span>ответили «приду»</span></div>
          <div><b>{summary.declined}</b><span>не смогут</span></div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Ответы гостей</h2>
            {summary.guests.length ? <a className={styles.button} href={exportHref}>Скачать Excel</a> : null}
          </div>
          {summary.guests.length === 0 ? (
            <p className={styles.muted}>Пока никто не ответил. Ответы появятся здесь сразу, как гости заполнят форму в приглашении.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr><th>Гость</th><th>Ответ</th><th>Человек</th><th>Когда</th></tr>
              </thead>
              <tbody>
                {summary.guests.map((g) => (
                  <tr key={`${g.name}-${g.at}`} className={g.answer === "no" ? styles.no : ""}>
                    <td>{g.name}{g.changes ? <small> · менял ответ</small> : null}</td>
                    <td>{ANSWER_LABEL[g.answer]}</td>
                    <td>{g.people}</td>
                    <td>{when(g.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.card}>
          <h2>Именные приглашения</h2>
          <p className={styles.muted}>
            Вставьте имена гостей — по одному в строке. Каждый получит свою ссылку: приглашение откроется со словами «Урматтуу Асан байке!», а имя уже будет вписано в форму ответа.
          </p>
          <PersonalLinks slug={link} title={displayTitle(inv)} />
        </section>

        <section className={styles.card}>
          <h2>Короткая ссылка и QR-код</h2>
          <ShortLink slug={slug} k={token} alias={managed.record.alias ?? ""} />
        </section>

        <section className={styles.card}>
          <h2>Пожелания гостей</h2>
          <WishesAdmin slug={slug} k={token} wishes={managed.wishes} />
        </section>

        <p className={styles.muted}>Эта страница открывается только по вашей ссылке. Не пересылайте её гостям.</p>
      </div>
    </main>
  );
}
