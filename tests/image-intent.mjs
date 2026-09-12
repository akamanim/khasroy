import { detectImageGenerationIntent } from "../lib/image-intent.ts";

const cases = [
  ["Сгенерируй мне зайчика", true],
  ["Нарисуй кота", true],
  ["Сделай BMW X5 на парковке", true],
  ["Сделай реалистичную BMW M5 CS на фоне заснеженных гор", true],
  ["Сгенерируй изображение по этому промпту", true],
  ["Generate a rabbit image", true],
  ["Create a car on a mountain road", true],
  ["Хасрой привет", false],
  ["Ты умеешь генерировать фото?", false],
  ["Расскажи про BMW", false],
  ["Сгенерируй пароль", false],
  ["Сгенерируй JSON", false],
  ["Сгенерируй промпт для фото", false],
  ["Напиши код генератора изображений", false],
];

let failed = 0;
for (const [text, expected] of cases) {
  const actual = Boolean(detectImageGenerationIntent(text));
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL: ${JSON.stringify(text)} expected=${expected} actual=${actual}`);
  } else {
    console.log(`PASS: ${JSON.stringify(text)} => ${actual ? "IMAGE" : "BRAIN"}`);
  }
}

if (failed > 0) {
  console.error(`Image intent regression test failed: ${failed}/${cases.length}`);
  process.exit(1);
}

console.log(`Image intent regression test passed: ${cases.length}/${cases.length}`);
