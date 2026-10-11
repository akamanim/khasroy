import assert from "node:assert/strict";
import { buildXlsx } from "../lib/xlsx-write.ts";
import { readWorkbook } from "../lib/sales/xlsx.ts";

const rows = [["Гость", "Ответ", "Человек"], ["Асан байке & Co <1>", "Приду с семьёй", 4], ["Айгуль", "Не смогу", 0]];
const file = buildXlsx("Гости", rows, [30, 20, 10]);
const back = readWorkbook(Buffer.from(file));
assert.deepEqual([...back.keys()], ["Гости"]);
assert.deepEqual(back.get("Гости"), [["Гость", "Ответ", "Человек"], ["Асан байке & Co <1>", "Приду с семьёй", "4"], ["Айгуль", "Не смогу", "0"]]);
if (process.argv[2]) (await import("node:fs")).writeFileSync(process.argv[2], file);
console.log("xlsx write: ok");
