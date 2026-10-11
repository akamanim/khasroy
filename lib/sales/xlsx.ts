import { inflateRawSync } from "node:zlib";

// Minimal .xlsx reader: enough to read cell text from a Google Sheets export. Google's CSV
// endpoints either need a numeric tab id or guess column types and drop "mismatched" cells
// (e.g. «договорная» in a price column), so we export the whole workbook once and read it here.

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, inflateRawSync(raw));
  }
  return files;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/giu, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gu, "&");
}

function texts(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((m) => decode(m[1])).join("");
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/u)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function number(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
}

/** Returns every tab of the workbook as rows of cell text, keyed by tab name. */
export function readWorkbook(buf: Buffer): Map<string, string[][]> {
  const files = unzip(buf);
  const read = (name: string) => files.get(name)?.toString("utf8") ?? "";
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/gu)].map((m) => texts(m[1]));
  const rels = new Map(
    [...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/gu)].map((m) => {
      const id = m[0].match(/\bId="([^"]+)"/u)?.[1] ?? "";
      const target = (m[0].match(/\bTarget="([^"]+)"/u)?.[1] ?? "").replace(/^\/?(xl\/)?/u, "xl/");
      return [id, target] as const;
    }),
  );
  const tabs = new Map<string, string[][]>();
  for (const m of read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/gu)) {
    const name = decode(m[0].match(/\bname="([^"]*)"/u)?.[1] ?? "");
    const rid = m[0].match(/\br:id="([^"]+)"/u)?.[1] ?? "";
    const xml = read(rels.get(rid) ?? "");
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+\d+)"/u)?.[1] ?? "";
        const type = attrs.match(/\bt="([^"]+)"/u)?.[1] ?? "n";
        const v = body.match(/<v>([\s\S]*?)<\/v>/u)?.[1] ?? "";
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = texts(body);
        else if (type === "b") value = v === "1" ? "да" : "нет";
        else if (type === "str" || type === "e") value = decode(v);
        else value = v ? number(v) : "";
        const index = ref ? columnIndex(ref) : cells.length;
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }
      rows.push(cells);
    }
    tabs.set(name, rows.filter((r) => r.some((x) => x.trim() !== "")));
  }
  return tabs;
}
