import type { Metadata } from "next";
import { companyValue } from "@/lib/sales/catalog";
import { loadCatalog } from "@/lib/sales/sheet";
import { SalesChat } from "../sales-chat";
import styles from "../sales.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Консультант — вариант Б", robots: { index: false, follow: false } };

// Variant B: Khasroy's proposal (server sessions, sales funnel, 7-message memory), for comparison with /sales.
export default async function SalesVariantB() {
  const catalog = await loadCatalog();
  const name = companyValue(catalog, "Название", "Компания") || "Магазин";
  const currency = companyValue(catalog, "Валюта");
  return (
    <main className={styles.page} style={{ display: "block", maxWidth: "none" }}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.avatar} aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
          <div>
            <h1>{name} · вариант Б</h1>
            <p><span className={styles.dot} />Воронка продаж по предложению Хасроя</p>
          </div>
        </header>
        <SalesChat shop={name} currency={currency} count={catalog.products.length} variant="b" />
      </div>
    </main>
  );
}
