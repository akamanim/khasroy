import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readWorkbook } from "../lib/sales/xlsx.ts";
import {
  rowsToObjects,
  toProducts,
  toCompany,
  toFaq,
  relevantProducts,
  unsupportedNumbers,
} from "../lib/sales/catalog.ts";

// Workbook reading: tab names, shared strings, numbers, escaped characters, empty rows.
const tabs = readWorkbook(readFileSync(new URL("./fixtures/sales-sample.xlsx", import.meta.url)));
assert.deepEqual([...tabs.keys()], ["Товары", "Компания", "Вопросы"]);
const products = toProducts(rowsToObjects(tabs.get("Товары")));
assert.equal(products.length, 2, "empty row dropped");
assert.equal(products[0].name, "Чайник «Steel» & Co");
assert.equal(products[0].price, "2490");
assert.equal(products[0].id, "K-1");
assert.equal(products[0].link, "https://example.com/k1");
assert.equal(products[1].price, "договорная", "text in a price column survives");
assert.equal(products[1].link, "", "non-https links are dropped");
assert.equal(products[0].fields["Описание"], "1,7 л, 2200 Вт");
assert.deepEqual(toCompany(tabs.get("Компания")), [{ key: "Название", value: "Тест" }, { key: "Валюта", value: "сом" }]);
assert.deepEqual(toFaq(tabs.get("Вопросы")), [{ q: "Есть скидки?", a: "Нет" }]);

// Search keeps small catalogs whole and ranks big ones by the conversation.
const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i), name: `Товар ${i}`, price: "", photo: "", link: "", stock: "", fields: { Название: `Товар ${i}` } }));
many[50] = { ...many[50], name: "Пылесос беспроводной", fields: { Название: "Пылесос беспроводной" } };
assert.equal(relevantProducts(many.slice(0, 10), "что угодно").length, 10);
assert.equal(relevantProducts(many, "нужен пылесос")[0].id, "50");

// Fact check: invented figures are caught, real ones and simple totals pass.
const db = "Чайник 2490 сом. Блендер 3 290 сом. Доставка 200 сом, бесплатно от 5000. WhatsApp +996 700 123 456";
assert.deepEqual(unsupportedNumbers("Чайник стоит 2 490 сом, блендер 3290.", [db]), []);
assert.deepEqual(unsupportedNumbers("Чайник стоит 1990 сом", [db]), ["1990"]);
assert.deepEqual(unsupportedNumbers("Скидка 15% и подарок", [db]), [], "two-digit numbers are not checked");
assert.deepEqual(unsupportedNumbers("Два чайника — 4980 сом", [db]), ["4980"], "a total needs its parts in the reply");
assert.deepEqual(unsupportedNumbers("Два чайника по 2490 — 4980 сом", [db]), []);
assert.deepEqual(unsupportedNumbers("Чайник 2490 и блендер 3290: вместе 5780", [db]), []);
assert.deepEqual(unsupportedNumbers("Пишите: 0700 123 456", [db]), [], "phone groups are known");
assert.deepEqual(unsupportedNumbers("Привезём за 350 сом", [db]), ["350"]);
assert.deepEqual(unsupportedNumbers("Да, мой бюджет 7000 учтём", [db, "бюджет до 7000"]), [], "customer's own figures are fine");

console.log("sales assistant: ok");
