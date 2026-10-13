// Khasroy as a reel writer: brief → script made of the studio's scene kinds → plan by fixed rules.
// The model only writes words and picks scene kinds; it never invents tools, links or numbers.

import { jsonCompletion } from "@/lib/sales/agent";
import type { Checked } from "@/lib/reels/catalog";
import { KINDS, cleanScript, scriptToPlan, type Script } from "@/lib/reels/compose";

/** What is known about ИИнна — taken from the brand's own reels. The model may not add facts. */
export const IINNA_FACTS = `ИИнна — ИИ-менеджер по продажам для магазинов в Instagram и WhatsApp.
Что умеет (из роликов бренда):
- отвечает клиентам сама, 24/7, с первого сообщения;
- понимает голосовые сообщения и отвечает по сути;
- принимает заказы и присылает владельцу уведомление в Telegram («Пришёл новый заказ»);
- спорные решения (например, скидку) спрашивает у владельца кнопками «Да / Нет»;
- сама предлагает подходящие товары из каталога;
- в кабинете: Главная, Товары и услуги, Заказы и записи, Чат, Умный торг, Настройки ИИ, Интеграции (Instagram, WhatsApp, Telegram).
Скидки и спорные решения ИИнна сама не принимает: клиенту отвечает «уточню и вернусь», а владелец решает кнопками «Да / Нет».
Тон бренда: уверенный, короткий, разговорный. В кадре говорит «я» — это ИИнна, она женского рода: «я сама», «поняла», «ответила». К владельцу — «вы». Валюта — сом.`;

// «фото» needs the owner's own picture, so only the owner adds it in the studio.
const KIND_LIST = Object.entries(KINDS).filter(([k]) => k !== "фото").map(([k, v]) => `- «${k}» — ${v.hint}`).join("\n");

const EXAMPLE = `{"title":"Пока вы спите","idea":"Ночью директ разрывается, а ИИнна отвечает сама и оставляет решения владельцу","scenes":[
{"seconds":2,"kind":"завал","text":"Директ *разрывается*","items":["Сколько стоит?","Есть размер M?","Доставка есть?"],"what":"Вопросы клиентов сыплются кучей"},
{"seconds":1.3,"kind":"удар","text":"СТОП.","what":"Резкий поворот"},
{"seconds":2.6,"kind":"ночь","text":"Пока вы *спите*","label":"ИИнна на связи","what":"Часы бегут через ночь"},
{"seconds":4,"kind":"голосовое","text":"Слушаю","lines":[{"from":"client","text":"Нужен *чёрный* на подарок, с гравировкой"},{"from":"inna","text":"Есть! Успеем на завтра :)"}],"what":"Клиент прислал голосовое, ИИнна поняла и ответила"},
{"seconds":3,"kind":"выбор","text":"Решаете *вы*","question":"Клиент просит скидку. Согласны?","what":"ИИнна спрашивает владельца"},
{"seconds":2.2,"kind":"реакция","text":"Заказ!","what":"Салют: заказ оформлен"},
{"seconds":2.6,"kind":"смена слов","text":"ИИнна","items":["отвечает","продаёт","напоминает"],"what":"Что она делает"},
{"seconds":2.6,"kind":"концовка","text":"Ссылка в профиле","label":"Отвечает клиентам 24/7","what":"Логотип и призыв"}]}`;

const SCRIPT_SYSTEM = `Ты — Хасрой, сценарист коротких вертикальных роликов (Reels) для бренда ИИнна.
${IINNA_FACTS}

Ролик собирается из готовых анимированных сцен. Живой съёмки, людей, рук, камеры, озвучки и музыки нет — только эти виды сцен (поле "kind"):
${KIND_LIST}

Правила:
- Факты, цифры, цены, имена — только из справки и из задачи владельца. Разрешённые цифры без задачи: 24/7 и 168 часов в неделе. Никаких других процентов, количеств, цен и сроков, если их нет в задаче («скидка» — без процента). Не придумывай ссылки, номера заказов, отзывы.
- 6–9 сцен, 15–25 секунд. Сцена 1 — крючок за 2 секунды (боль, завал, бегущая строка, сомнение или ночь). Дальше поворот → как ИИнна решает (1–3 примера: голосовое, переписка, печать, выбор, уведомление, товар) → результат (реакция, до/после, смена слов) → вывод. Последняя сцена — «концовка».
- "text" обязателен в каждой сцене — надпись на экране: 1–5 слов, разговорно, без канцелярита. Ключевое слово можно выделить: *слово*. Для «удар» — одно слово.
- «товар» — только если владелец назвал товар; тогда "name" и, если дана, "price".
- «уведомление» — "title" (заголовок пуша, например «Пришёл новый заказ») и при желании "body".
- «экран» — "section": точное название раздела кабинета из справки.
- В «переписка» и «голосовое» обязательно "lines": реплики клиента (from:"client") и ИИнны (from:"inna"), короткие и живые.
- В «выбор» обязательно "question" — вопрос владельцу.
- "what" — одна фраза для владельца: что происходит в сцене.
- Сцены одного вида не ставь подряд.
- Будь изобретательным, как моушн-дизайнер: минимум 5 разных видов сцен, из них хотя бы 2 творческих («печать», «до/после», «бегущая строка», «завал», «ночь», «смена слов», «реакция»). Крючок — неожиданный: не начинай каждый ролик с вопроса. Каждый новый сценарий собирай по-новому, не повторяй пример.
- «до/после» — "before": 2–3 проблемы без ИИнны, "items": 2–3 решения с ней. «завал» и «смена слов» — "items". Пункты по 1–3 слова.

Пример хорошего сценария (стиль и формат, не копируй дословно):
${EXAMPLE}

Ответь только JSON такого же вида.`;

export async function writeScript(brief: string, previous?: Script, feedback?: string): Promise<{ script: Script; model: string }> {
  const user = previous
    ? `Задача владельца: ${brief}\n\nПрошлый вариант сценария:\n${JSON.stringify(previous)}\n\nЧто поменять: ${feedback || "сделай сильнее"}\nПерепиши сценарий целиком с учётом правок.`
    : `Задача владельца: ${brief}`;
  const { data, model } = await jsonCompletion(
    [
      { role: "system", content: SCRIPT_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.9, maxTokens: 2400, reasoningEffort: "low" },
  );
  const script = cleanScript(data);
  if (script.scenes.length < 3) throw new Error("Хасрой написал слишком короткий сценарий — попробуйте ещё раз.");
  return { script, model };
}

/** The approved script becomes a plan by fixed rules — no second model call, nothing invented.
 *  Every build gets a fresh seed, so the same script comes out with new moves, music and looks;
 *  the seed is saved in the plan, so the render matches the preview. */
export async function buildPlan(script: Script, seed = Math.floor(Math.random() * 1_000_000), style?: string): Promise<Checked & { model: string }> {
  return { ...scriptToPlan(script, seed, { style }), model: "rules" };
}

export { cleanScript };
