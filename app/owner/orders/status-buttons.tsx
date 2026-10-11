"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./orders.module.css";

const NEXT: Record<string, Array<[string, string]>> = {
  submitted: [["approved", "Оплачен"], ["archived", "В архив"]],
  approved: [["published", "Опубликовать"], ["submitted", "Вернуть в новые"]],
  published: [["approved", "Снять с публикации"], ["archived", "В архив"]],
};

export function StatusButtons({ slug, status }: { slug: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function change(next: string) {
    setBusy(next);
    setError("");
    try {
      const response = await fetch("/api/owner/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, status: next }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || String(response.status));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.actions}>
      {(NEXT[status] ?? []).map(([value, label]) => (
        <button key={value} type="button" disabled={Boolean(busy)} onClick={() => change(value)}>
          {busy === value ? "…" : label}
        </button>
      ))}
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}
