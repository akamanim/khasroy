import type { Metadata } from "next";
import { companyValue, type Catalog } from "@/lib/sales/catalog";
import { loadCatalog } from "@/lib/sales/sheet";
import { SalesChat } from "./sales-chat";
import styles from "./sales.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const catalog = await loadCatalog().catch(() => null);
  const name = catalog ? companyValue(catalog, "Название", "Компания") : "";
  return { title: name ? `${name} — консультант` : "Консультант", robots: { index: false, follow: false } };
}

export default async function SalesPage() {
  let catalog: Catalog | null = null;
  let failure = "";
  try {
    catalog = await loadCatalog();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error("Sales catalog load failed", error);
  }

  const name = catalog ? companyValue(catalog, "Название", "Компания") || "Магазин" : "Магазин";
  const currency = catalog ? companyValue(catalog, "Валюта") : "";
  const hours = catalog ? companyValue(catalog, "Часы работы", "График") : "";

  return (
    // Global CSS turns every <main> into the owner console's grid; reset that here.
    <main className={styles.page} style={{ display: "block", maxWidth: "none" }}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.avatar} aria-hidden>{name.slice(0, 1).toUpperCase()}</div>
          <div>
            <h1>{name}</h1>
            <p><span className={styles.dot} />Консультант на связи{hours ? ` · ${hours}` : ""}</p>
          </div>
        </header>
        {catalog?.source === "demo" && (
          <p className={styles.notice}>Демо-данные: Google Таблица ещё не подключена, товары и магазин вымышленные.</p>
        )}
        {catalog ? (
          <SalesChat shop={name} currency={currency} count={catalog.products.length} />
        ) : (
          <p className={styles.notice}>Не удалось прочитать базу товаров из Google Таблицы. Проверьте, что доступ открыт «всем, у кого есть ссылка». {failure ? `(${failure})` : ""}</p>
        )}
      </div>
    </main>
  );
}
