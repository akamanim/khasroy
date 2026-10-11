"use client";

import { useState } from "react";
import { PUBLIC_ORIGIN } from "@/lib/invitations/share";
import styles from "./guests.module.css";

async function manage(slug: string, k: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/invite/manage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, k, ...payload }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; alias?: string | null };
  if (!response.ok) throw new Error(data.error || "Не удалось сохранить.");
  return data;
}

/** Custom short link and a printable QR code. */
export function ShortLink({ slug, k, alias: initial }: { slug: string; k: string; alias: string }) {
  const [alias, setAlias] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const link = `${PUBLIC_ORIGIN}/i/${alias || slug}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await manage(slug, k, { action: "alias", alias: draft.trim().toLowerCase() });
      setAlias(data.alias ?? "");
      setDraft(data.alias ?? "");
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.short}>
      <p className={styles.muted}>Ссылка для гостей: <a href={link} target="_blank" rel="noopener noreferrer">{link.replace(/^https:\/\//u, "")}</a></p>
      <form className={styles.aliasForm} onSubmit={save}>
        <span>{PUBLIC_ORIGIN.replace(/^https:\/\//u, "")}/i/</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))}
          placeholder="aibek-aiperi"
          maxLength={40}
          aria-label="Короткая ссылка"
        />
        <button type="submit" className={styles.button} disabled={busy || draft === alias}>{busy ? "…" : "Сохранить"}</button>
      </form>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.qr}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/i/${slug}/qr?v=${version}`} alt={`QR-код: ${link}`} width={180} height={180} />
        <div>
          <p className={styles.muted}>QR-код ведёт на эту ссылку. Его можно напечатать на бумажном приглашении или поставить на стол у входа.</p>
          <a className={styles.button} href={`/i/${slug}/qr?download&v=${version}`}>Скачать QR (SVG)</a>
        </div>
      </div>
    </div>
  );
}

type Wish = { id: string; guest_name: string; text: string; created_at: string; hidden?: boolean };

/** All wishes with a hide/show switch for each. */
export function WishesAdmin({ slug, k, wishes: initial }: { slug: string; k: string; wishes: Wish[] }) {
  const [wishes, setWishes] = useState(initial);
  const [error, setError] = useState("");

  async function toggle(w: Wish) {
    setError("");
    try {
      await manage(slug, k, { action: "hide_wish", id: w.id, hidden: !w.hidden });
      setWishes((list) => list.map((x) => (x.id === w.id ? { ...x, hidden: !w.hidden } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!wishes.length) return <p className={styles.muted}>Пока пожеланий нет. Они появятся здесь сразу, как гости их оставят.</p>;
  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      <ul className={styles.wishAdmin}>
        {wishes.map((w) => (
          <li key={w.id} className={w.hidden ? styles.hiddenWish : ""}>
            <div>
              <p>{w.text}</p>
              <span>— {w.guest_name}{w.hidden ? " · скрыто" : ""}</span>
            </div>
            <button type="button" onClick={() => toggle(w)}>{w.hidden ? "Показать" : "Скрыть"}</button>
          </li>
        ))}
      </ul>
    </>
  );
}
