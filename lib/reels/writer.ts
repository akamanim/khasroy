// Khasroy as a reel writer: brief → script (for the owner to approve) → plan made of tools.
// The model only writes words and picks tools; the checker repairs what it gets wrong.

import { jsonCompletion } from "@/lib/sales/agent";
import { catalogForPrompt, checkPlan, type Checked } from "@/lib/reels/catalog";
import type { Script, ScriptScene } from "@/lib/reels/server";

/** What is known about ИИнна — taken from the brand's own reels. The model may not add facts. */
export const IINNA_FACTS = `ИИнна — ИИ-менеджер по продажам для магазинов в Instagram и WhatsApp.
Что умеет (из роликов бренда):
- отвечает клиентам сама, 24/7, с первого сообщения;
- понимает голосовые сообщения и отвечает по сути;
- принимает заказы и присылает владельцу уведомление в Telegram («Пришёл новый заказ»);
- спорные решения (например, скидку) спрашивает у владельца кнопками «Да / Нет»;
- сама предлагает подходящие товары из каталога;
- в кабинете: Главная, Товары и услуги, Заказы и записи, Чат, Умный торг, Настройки ИИ, Интеграции (Instagram, WhatsApp, Telegram).
Тон бренда: уверенный, короткий, разговорный; «я» — это ИИнна; владельцу — «вы». Валюта — сом.`;

const SCRIPT_SYSTEM = `Ты — Хасрой, сценарист коротких вертикальных роликов (Reels) для бренда ИИнна.
${IINNA_FACTS}

Правила:
- Факты (функции, цифры, цены) — только из справки выше и из задачи владельца. Ничего не выдумывай. Нет цифры — не пиши цифру.
- Ролик 15–30 секунд, 6–10 сцен. Первые 2 секунды — крючок (вопрос, сомнение, боль). Дальше: поворот → как ИИнна решает → пример (переписка, голосовое, заказ, товар) → вывод. Последняя сцена — концовка с логотипом и призывом.
- Надпись на экране — 1–6 слов, разговорно, без канцелярита. Можно выделить ключевое слово звёздочками: *слово*.
- «what» — что видно в кадре, одной фразой, для дизайнера.
Ответь только JSON: {"title":"…","idea":"одна фраза — о чём ролик","scenes":[{"seconds":2.5,"what":"…","text":"…"}]}`;

const PLAN_SYSTEM = `Ты собираешь утверждённый сценарий ролика из готовых инструментов. Код не пишешь — только выбираешь инструменты и заполняешь параметры.
Инструменты (имя — назначение — параметры; * — обязательный):
${catalogForPrompt()}

Правила:
- Одна сцена сценария — одна сцена плана. Бери тексты из сценария, смысл не меняй; можно разбить на строки (\\n) и выделить *слово*.
- Подбирай инструмент по смыслу кадра: переписка → chat, голосовое → voice, заказ/уведомление → notification, решение владельца → choice, товар → product, цифра → counter или dot_grid, резкий поворот одним словом → slam, сомнение/вопрос → glitch, перечень → list, обычная мысль → headline. Последняя сцена — outro.
- Чередуй фон: cream, black, violet — не больше двух сцен подряд одного цвета.
- Переходы: cut — для резких ударов (slam, glitch); wipe, slide, push, zoom, fade, iris — для смены темы. Один и тот же переход не больше двух раз подряд. У первой сцены — cut.
- Длительность сцены — из сценария, в пределах инструмента.
Ответь только JSON: {"title":"…","scenes":[{"tool":"headline","duration":2.4,"transition":"cut","params":{"text":"Я *сама*\\nнапишу","bg":"cream"}}]}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Cleans the model's script so the owner sees something sensible even if the model was sloppy. */
export function cleanScript(raw: Record<string, unknown>): Script {
  const scenes: ScriptScene[] = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
    .filter((s): s is Record<string, unknown> => Boolean(s && (str(s.text, 80) || str(s.what, 200))))
    .slice(0, 12)
    .map((s) => ({
      seconds: Math.min(6, Math.max(1, Math.round((Number(s.seconds) || 2.5) * 10) / 10)),
      what: str(s.what, 200),
      text: str(s.text, 80),
    }));
  return { title: str(raw.title, 80) || "Рилс ИИнны", idea: str(raw.idea, 200), scenes };
}

export async function writeScript(brief: string, previous?: Script, feedback?: string): Promise<{ script: Script; model: string }> {
  const user = previous
    ? `Задача владельца: ${brief}\n\nПрошлый вариант сценария:\n${JSON.stringify(previous, null, 1)}\n\nЧто поменять: ${feedback || "сделай сильнее"}\nПерепиши сценарий с учётом правок.`
    : `Задача владельца: ${brief}`;
  const { data, model } = await jsonCompletion(
    [
      { role: "system", content: SCRIPT_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.8, maxTokens: 1800, reasoningEffort: "low" },
  );
  const script = cleanScript(data);
  if (script.scenes.length < 3) throw new Error("Хасрой написал слишком короткий сценарий — попробуйте ещё раз.");
  return { script, model };
}

/** Turns the approved script into a checked plan; one retry if the checker found real errors. */
export async function buildPlan(script: Script): Promise<Checked & { model: string }> {
  const scriptText = script.scenes.map((s, i) => `${i + 1}. [${s.seconds} с] Кадр: ${s.what} | Надпись: ${s.text}`).join("\n");
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content: `Сценарий «${script.title}»:\n${scriptText}` },
  ];
  let { data, model } = await jsonCompletion(messages, { temperature: 0.3, maxTokens: 3500, reasoningEffort: "low" });
  let checked = checkPlan({ ...data, title: script.title });
  if (checked.errors.length) {
    messages.push({ role: "assistant", content: JSON.stringify(data) }, { role: "user", content: `Проверка нашла ошибки: ${checked.errors.join("; ")}. Исправь и пришли план целиком.` });
    ({ data, model } = await jsonCompletion(messages, { temperature: 0.2, maxTokens: 3500, reasoningEffort: "low" }));
    checked = checkPlan({ ...data, title: script.title });
  }
  return { ...checked, model };
}
