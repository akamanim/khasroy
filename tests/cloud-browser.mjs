import assert from "node:assert/strict";
import { assertPublicUrl, isPrivateHost, isRiskyLabel, isSecretField, normalizeUrl } from "../lib/browser/guard.ts";

assert.equal(normalizeUrl("kelshi.kz"), "https://kelshi.kz/");
assert.equal(normalizeUrl("http://example.com/a?b=1"), "http://example.com/a?b=1");
assert.equal(normalizeUrl("javascript:alert(1)"), null);
assert.equal(normalizeUrl("file:///etc/passwd"), null);
assert.equal(normalizeUrl("просто текст"), null);
assert.equal(normalizeUrl(""), null);

for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.20.0.1", "192.168.1.1", "[::1]", "::ffff:10.0.0.1", "fd00::1", "metadata.google.internal", "0.0.0.0"]) {
  assert.ok(isPrivateHost(host), `${host} must be private`);
}
for (const host of ["kelshi.kz", "8.8.8.8", "172.32.0.1", "example.com"]) assert.ok(!isPrivateHost(host), `${host} is public`);

await assert.rejects(assertPublicUrl("http://169.254.169.254/latest"));
await assert.rejects(assertPublicUrl("https://evil.example/", async () => ["10.0.0.5"]));
await assertPublicUrl("https://example.com/", async () => ["93.184.215.14"]);

for (const label of ["Купить", "Оформить заказ", "Оплатить картой", "Войти", "Submit", "Отправить заявку", "Add to cart → Checkout"]) {
  assert.ok(isRiskyLabel(label), `${label} needs confirmation`);
}
for (const label of ["Каталог", "Цены", "Подробнее", "Следующая страница", "Поиск"]) assert.ok(!isRiskyLabel(label), `${label} is safe`);

assert.ok(isSecretField("password", ""));
assert.ok(isSecretField("text", "cc-number"));
assert.ok(isSecretField("tel", "card_cvc"));
assert.ok(!isSecretField("search", "q"));

console.log("cloud-browser guard: ok");
