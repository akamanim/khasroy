import { rowsToObjects, toCompany, toFaq, toProducts, type Catalog } from "@/lib/sales/catalog";
import { DEMO_CATALOG } from "@/lib/sales/demo-catalog";
import { readWorkbook } from "@/lib/sales/xlsx";

// The owner keeps the database in a Google Sheet with three tabs: «Товары», «Компания»,
// «Вопросы». The sheet is shared «anyone with the link can view»; we download it as .xlsx
// (one request, every tab, cell text exactly as typed), so no Google keys are needed.
export const SHEET_TABS = { products: "Товары", company: "Компания", faq: "Вопросы" } as const;
const CACHE_MS = 60_000;

let cache: { at: number; sheetId: string; catalog: Catalog } | null = null;

export function sheetIdFrom(value: string | undefined): string {
  const raw = (value ?? "").trim();
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/u)?.[1];
  if (fromUrl) return fromUrl;
  return /^[a-zA-Z0-9_-]{20,}$/u.test(raw) ? raw : "";
}

function findTab(tabs: Map<string, string[][]>, name: string): string[][] {
  for (const [key, rows] of tabs) if (key.trim().toLowerCase() === name.toLowerCase()) return rows;
  return [];
}

/** Loads the catalog; falls back to the labelled demo data only when no sheet is configured. */
export async function loadCatalog(): Promise<Catalog> {
  const sheetId = sheetIdFrom(process.env.KHASROY_SALES_SHEET);
  if (!sheetId) return DEMO_CATALOG;
  if (cache && cache.sheetId === sheetId && Date.now() - cache.at < CACHE_MS) return cache.catalog;

  const response = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const buf = Buffer.from(await response.arrayBuffer());
  // A sheet that is not shared answers with Google's HTML sign-in page instead of a file.
  if (!response.ok || buf.subarray(0, 2).toString() !== "PK") {
    throw new Error(`Google Sheet ${sheetId} is not readable (status ${response.status}); share it «anyone with the link can view»`);
  }
  const tabs = readWorkbook(buf);
  const firstTab = [...tabs.values()][0] ?? [];
  const productRows = findTab(tabs, SHEET_TABS.products);
  const catalog: Catalog = {
    products: toProducts(rowsToObjects(productRows.length ? productRows : firstTab)).slice(0, 2000),
    company: toCompany(findTab(tabs, SHEET_TABS.company)),
    faq: toFaq(findTab(tabs, SHEET_TABS.faq)),
    source: "sheet",
    loadedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), sheetId, catalog };
  return catalog;
}
