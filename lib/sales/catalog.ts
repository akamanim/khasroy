// Pure helpers for the sales assistant: parsing the owner's Google Sheet, finding the
// products relevant to a question and checking that a reply quotes only real figures.
// No I/O here so the rules can be tested with plain Node.

export type Row = Record<string, string>;

export type Product = {
  id: string;
  name: string;
  price: string;
  photo: string;
  link: string;
  stock: string;
  /** Every non-empty column from the sheet, exactly as the owner wrote it. */
  fields: Row;
};

export type Catalog = {
  products: Product[];
  company: Array<{ key: string; value: string }>;
  faq: Array<{ q: string; a: string }>;
  source: "sheet" | "builtin";
  loadedAt: string;
};

export function rowsToObjects(rows: string[][]): Row[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const out: Row = {};
    header.forEach((h, i) => {
      const value = (cells[i] ?? "").trim();
      if (h && value) out[h] = value.slice(0, 2000);
    });
    return out;
  }).filter((r) => Object.keys(r).length > 0);
}

const ALIASES = {
  id: ["id", "артикул", "код", "sku"],
  name: ["название", "наименование", "товар", "услуга", "name"],
  price: ["цена", "стоимость", "price"],
  photo: ["фото", "картинка", "изображение", "photo", "image"],
  link: ["ссылка", "link", "url"],
  stock: ["наличие", "остаток", "в наличии", "stock"],
} as const;

function pickField(row: Row, names: readonly string[]): string {
  for (const key of Object.keys(row)) {
    if (names.includes(key.toLowerCase().trim())) return row[key];
  }
  return "";
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function toProducts(rows: Row[]): Product[] {
  return rows
    .map((fields, index) => {
      const name = pickField(fields, ALIASES.name);
      return {
        id: pickField(fields, ALIASES.id) || String(index + 1),
        name,
        price: pickField(fields, ALIASES.price),
        photo: safeUrl(pickField(fields, ALIASES.photo)),
        link: safeUrl(pickField(fields, ALIASES.link)),
        stock: pickField(fields, ALIASES.stock),
        fields,
      };
    })
    .filter((p) => p.name);
}

export function toCompany(rows: string[][]) {
  return rows
    .map(([key = "", value = ""]) => ({ key: key.trim(), value: value.trim().slice(0, 2000) }))
    .filter((r) => r.key && r.value && !/^(поле|field|ключ)$/iu.test(r.key));
}

export function toFaq(rows: string[][]) {
  return rows
    .map(([q = "", a = ""]) => ({ q: q.trim(), a: a.trim().slice(0, 2000) }))
    .filter((r) => r.q && r.a && !/^(вопрос|question)$/iu.test(r.q));
}

export function companyValue(catalog: Catalog, ...names: string[]): string {
  const wanted = names.map((n) => n.toLowerCase());
  return catalog.company.find((r) => wanted.includes(r.key.toLowerCase()))?.value ?? "";
}

// ---------------------------------------------------------------- search

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
}

/** Crude stem: compares the first 5 letters so «телефоны», «телефона», «телефон» match. */
function stem(word: string) {
  return word.length > 5 ? word.slice(0, 5) : word;
}

/**
 * Returns the products to put in front of the model. Small catalogs go in whole; larger ones
 * are ranked by word overlap with the recent conversation so the prompt stays bounded.
 */
export function relevantProducts(products: Product[], conversation: string, limit = 40): Product[] {
  if (products.length <= limit) return products;
  const query = new Set(words(conversation).map(stem));
  const scored = products.map((p, index) => {
    const text = words(Object.values(p.fields).join(" ")).map(stem);
    const nameWords = new Set(words(p.name).map(stem));
    let score = 0;
    for (const w of text) if (query.has(w)) score += nameWords.has(w) ? 3 : 1;
    return { p, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.p);
}

// ---------------------------------------------------------------- fact check

function numbersIn(text: string): string[] {
  const out: string[] = [];
  // Numbers like 12 500, 12500, 12.500, 1,5 — normalised to digits only. A separator joins
  // groups only when exactly three digits follow, so "2490, 3290" stays two numbers.
  for (const match of text.matchAll(/\d{1,3}(?:[ \u00a0.,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/gu)) {
    const digits = match[0].replace(/[\s.,]/gu, "");
    if (digits) out.push(digits);
  }
  return out;
}

/** True when n can be written as q1·a + q2·b + q3·c with quantities 0–10 of up to three bases. */
function isTotal(n: number, bases: number[]): boolean {
  const b = [...new Set(bases)].filter((x) => x > 0).slice(0, 12);
  for (let i = 0; i < b.length; i += 1) {
    for (let qi = 1; qi <= 10; qi += 1) {
      const s1 = qi * b[i];
      if (s1 === n) return true;
      for (let j = i + 1; j < b.length; j += 1) {
        for (let qj = 1; qj <= 10; qj += 1) {
          const s2 = s1 + qj * b[j];
          if (s2 === n) return true;
          for (let k = j + 1; k < b.length; k += 1) {
            if ((n - s2) > 0 && (n - s2) % b[k] === 0 && (n - s2) / b[k] <= 10) return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Figures (prices, discounts, terms) the reply states that appear nowhere in the database or in
 * what the customer wrote. Small numbers (1–2 digits) are ignored: they are usually counts.
 * Allowed too: digit groups of longer numbers (a phone written with different spacing) and
 * totals built from figures the reply itself quotes (2 × 2490 = 4980).
 */
export function unsupportedNumbers(reply: string, sources: string[]): string[] {
  const allowed = new Set<string>();
  const long: string[] = [];
  for (const text of sources) {
    for (const n of numbersIn(text)) {
      allowed.add(n);
      if (n.length >= 7) long.push(n);
    }
    for (const g of text.match(/\d+/gu) ?? []) allowed.add(g);
  }
  const candidates = [...new Set(numbersIn(reply).filter((n) => n.length >= 3))];
  const known = (n: string) =>
    allowed.has(n) || long.some((l) => l.includes(n) || l.includes(n.replace(/^0+/u, "")));
  const bases = candidates.filter(known).map(Number);
  return candidates.filter((n) => !known(n) && !isTotal(Number(n), bases));
}

export function catalogText(catalog: Catalog, products: Product[]): string {
  const company = catalog.company.map((r) => `${r.key}: ${r.value}`).join("\n");
  const faq = catalog.faq.map((r) => `В: ${r.q}\nО: ${r.a}`).join("\n");
  const items = products
    .map((p) => `[id=${p.id}] ` + Object.entries(p.fields).map(([k, v]) => `${k}: ${v}`).join(" | "))
    .join("\n");
  return `О КОМПАНИИ\n${company || "(нет данных)"}\n\nЧАСТЫЕ ВОПРОСЫ\n${faq || "(нет данных)"}\n\nТОВАРЫ\n${items || "(нет товаров)"}`;
}
