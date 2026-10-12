// Catalog of reel tools for Khasroy. The model never writes animation code: it picks tools from
// this list and fills their parameters. The renderer (public/reels-runtime/tools.js) draws them.
// Keep names and parameters in sync with tools.js — tests/reels.mjs checks that.

export type ParamSpec =
  | { type: "text"; max: number; maxLines?: number; required?: boolean; hint: string }
  | { type: "number"; min: number; max: number; hint: string }
  | { type: "enum"; values: string[]; default: string; hint: string }
  | { type: "list"; maxItems: number; maxLength: number; hint: string }
  | { type: "messages"; maxItems: number; maxLength: number; hint: string }
  | { type: "url"; hint: string }
  | { type: "box"; hint: string };

export type Shelf = "opening" | "story" | "proof" | "brand";

export type ToolSpec = {
  name: string;
  shelf: Shelf;
  title: string;
  use: string;
  duration: { min: number; default: number; max: number };
  bg: string[];
  params: Record<string, ParamSpec>;
};

const BG = (values: string[], def: string): ParamSpec => ({ type: "enum", values, default: def, hint: "фон сцены" });
const HEADLINE = (max = 40): ParamSpec => ({
  type: "text",
  max,
  maxLines: 3,
  hint: "крупный заголовок; \\n — новая строка; *слово* — фиолетовым",
});

export const TOOLS: ToolSpec[] = [
  {
    name: "headline",
    shelf: "opening",
    title: "Крупная надпись",
    use: "Главная мысль сцены крупными буквами, слово за словом. Начало ролика, поворот, вывод.",
    duration: { min: 1.4, default: 2.4, max: 4 },
    bg: ["cream", "black", "violet"],
    params: {
      text: { type: "text", max: 48, maxLines: 4, required: true, hint: "2–7 слов; \\n — строка; *слово* — акцент" },
      label: { type: "text", max: 40, hint: "мелкая подпись (необязательно)" },
      align: { type: "enum", values: ["top", "center", "bottom"], default: "top", hint: "где стоит текст" },
      size: { type: "enum", values: ["m", "l", "xl"], default: "l", hint: "размер" },
      bg: BG(["cream", "black", "violet"], "cream"),
    },
  },
  {
    name: "slam",
    shelf: "opening",
    title: "Удар",
    use: "Одно короткое слово на весь экран с ударом: «НЕТ.», «ДА.», «СТОП.». Резкий поворот.",
    duration: { min: 0.8, default: 1.3, max: 2 },
    bg: ["violet", "black", "cream"],
    params: {
      text: { type: "text", max: 10, maxLines: 1, required: true, hint: "1 слово, до 10 знаков" },
      label: { type: "text", max: 36, hint: "подпись под словом (необязательно)" },
      bg: BG(["violet", "black", "cream"], "violet"),
    },
  },
  {
    name: "glitch",
    shelf: "opening",
    title: "Глитч",
    use: "Тревожный вопрос или сомнение с цифровым сбоем: «Пришёл ли заказ?».",
    duration: { min: 1, default: 1.6, max: 2.4 },
    bg: ["black", "cream", "violet"],
    params: {
      text: { type: "text", max: 24, maxLines: 2, required: true, hint: "короткая фраза" },
      bg: BG(["black", "cream", "violet"], "black"),
    },
  },
  {
    name: "counter",
    shelf: "proof",
    title: "Большая цифра",
    use: "Цифра, которая считается: часы, клиенты, сумма, проценты. Доказательство.",
    duration: { min: 1.8, default: 2.6, max: 3.6 },
    bg: ["cream", "black", "violet"],
    params: {
      value: { type: "text", max: 9, maxLines: 1, required: true, hint: "число («168», «4 900») или «24/7»" },
      from: { type: "number", min: 0, max: 1e9, hint: "с какого числа считать" },
      headline: HEADLINE(36),
      label: { type: "text", max: 40, hint: "что это за цифра" },
      bg: BG(["cream", "black", "violet"], "cream"),
    },
  },
  {
    name: "dot_grid",
    shelf: "proof",
    title: "Сетка точек",
    use: "Время или доля наглядно: точки заполняются (часы в неделе, дни в месяце).",
    duration: { min: 2.4, default: 3, max: 4 },
    bg: ["cream"],
    params: {
      headline: HEADLINE(44),
      number: { type: "number", min: 0, max: 100000, hint: "большое число внизу" },
      label: { type: "text", max: 32, hint: "подпись к числу" },
      filled: { type: "number", min: 0, max: 1, hint: "доля заполненных точек 0…1" },
      columns: { type: "number", min: 3, max: 10, hint: "столбцов (7 — дни недели)" },
      rows: { type: "number", min: 4, max: 30, hint: "строк (24 — часы)" },
    },
  },
  {
    name: "notification",
    shelf: "story",
    title: "Уведомление",
    use: "На телефон приходит пуш: новый заказ, заявка, оплата.",
    duration: { min: 2, default: 2.6, max: 3.4 },
    bg: ["black", "cream"],
    params: {
      headline: HEADLINE(24),
      sub: { type: "text", max: 20, hint: "мелкая строка (№ заказа)" },
      app: { type: "text", max: 16, hint: "приложение (Telegram, WhatsApp)" },
      title: { type: "text", max: 32, hint: "заголовок уведомления" },
      body: { type: "text", max: 40, hint: "текст уведомления" },
      bg: BG(["black", "cream"], "black"),
    },
  },
  {
    name: "chat",
    shelf: "story",
    title: "Переписка",
    use: "Клиент пишет, ИИнна отвечает. Показать, как общение идёт само.",
    duration: { min: 2.6, default: 4, max: 6 },
    bg: ["cream", "black"],
    params: {
      contact: { type: "text", max: 24, hint: "имя клиента" },
      channel: { type: "text", max: 24, hint: "откуда (Instagram Direct)" },
      headline: { type: "text", max: 28, hint: "мелкая строка сверху" },
      messages: { type: "messages", maxItems: 4, maxLength: 90, hint: "[{from:'client'|'me', text}] — до 4 сообщений" },
      bg: BG(["cream", "black"], "cream"),
    },
  },
  {
    name: "voice",
    shelf: "story",
    title: "Голосовое",
    use: "Клиент присылает голосовое, ИИнна слушает, понимает и отвечает.",
    duration: { min: 3, default: 4.2, max: 5.5 },
    bg: ["black"],
    params: {
      headline: HEADLINE(16),
      who: { type: "text", max: 24, hint: "кто прислал" },
      duration: { type: "text", max: 5, hint: "длина «0:07»" },
      transcript: { type: "text", max: 80, hint: "что сказал клиент; *слово* — выделить" },
      reply: { type: "text", max: 80, hint: "ответ ИИнны" },
    },
  },
  {
    name: "choice",
    shelf: "story",
    title: "Выбор Да/Нет",
    use: "Вопрос владельцу и две кнопки; палец нажимает одну. Решения остаются за вами.",
    duration: { min: 2.4, default: 3, max: 3.6 },
    bg: ["cream", "black"],
    params: {
      headline: HEADLINE(24),
      question: { type: "text", max: 70, required: true, hint: "вопрос" },
      options: { type: "list", maxItems: 2, maxLength: 12, hint: "две кнопки" },
      pick: { type: "number", min: 0, max: 1, hint: "какую нажать (0 или 1)" },
      bg: BG(["cream", "black"], "cream"),
    },
  },
  {
    name: "list",
    shelf: "proof",
    title: "Список с галочками",
    use: "Что умеет / что входит: 2–4 пункта ставятся галочками.",
    duration: { min: 2.4, default: 3.4, max: 4.4 },
    bg: ["black", "cream"],
    params: {
      headline: HEADLINE(24),
      items: { type: "list", maxItems: 4, maxLength: 26, hint: "пункты" },
      bg: BG(["black", "cream"], "black"),
    },
  },
  {
    name: "product",
    shelf: "story",
    title: "Карточка товара",
    use: "Товар с фото, названием и ценой. Предложение, новинка, хит.",
    duration: { min: 2.2, default: 2.8, max: 3.6 },
    bg: ["cream", "black"],
    params: {
      headline: HEADLINE(24),
      name: { type: "text", max: 24, required: true, hint: "название" },
      caption: { type: "text", max: 32, hint: "кратко о товаре" },
      price: { type: "text", max: 14, hint: "цена «2 900 сом»" },
      tag: { type: "text", max: 10, hint: "ярлык «Хит», «Новинка»" },
      image: { type: "url", hint: "фото товара (https)" },
      bg: BG(["cream", "black"], "cream"),
    },
  },
  {
    name: "screen",
    shelf: "story",
    title: "Экран-шаг",
    use: "Обучалка: шаг N, название раздела и снимок экрана с выделенным местом.",
    duration: { min: 2.4, default: 3.2, max: 4.4 },
    bg: ["black"],
    params: {
      step: { type: "text", max: 9, hint: "«02 / 08»" },
      title: { type: "text", max: 22, required: true, hint: "раздел" },
      subtitle: { type: "text", max: 40, hint: "мелкая строка" },
      image: { type: "url", hint: "снимок экрана (https)" },
      highlight: { type: "box", hint: "{x,y,w,h} в % снимка" },
      note: { type: "text", max: 24, hint: "подсказка под выделением" },
    },
  },
  {
    name: "badge",
    shelf: "brand",
    title: "Бейдж ИИнны",
    use: "Бейдж на шнурке: «Ваш личный менеджер». Представление бренда.",
    duration: { min: 2.4, default: 3, max: 3.6 },
    bg: ["cream"],
    params: {
      name: { type: "text", max: 10, hint: "имя на бейдже" },
      role: { type: "text", max: 24, hint: "должность" },
      letter: { type: "text", max: 1, hint: "буква в круге" },
      headline: HEADLINE(32),
    },
  },
  {
    name: "outro",
    shelf: "brand",
    title: "Концовка",
    use: "Логотип и призыв к действию. Всегда последняя сцена.",
    duration: { min: 2, default: 2.6, max: 3.4 },
    bg: ["violet", "black", "cream"],
    params: {
      brand: { type: "text", max: 10, hint: "название" },
      line: { type: "text", max: 36, hint: "строка под логотипом" },
      cta: { type: "text", max: 24, hint: "кнопка «Ссылка в профиле»" },
      bg: BG(["violet", "black", "cream"], "violet"),
    },
  },
];

export const TRANSITIONS = ["cut", "fade", "slide", "push", "zoom", "wipe", "iris"] as const;
export const MAX_SCENES = 14;
export const MAX_SECONDS = 60;

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const toolSpec = (name: string) => BY_NAME.get(name);

/** Compact description of the tools for the model's prompt (only some shelves, to keep it short). */
export function catalogForPrompt(shelves?: Shelf[]): string {
  return TOOLS.filter((t) => !shelves || shelves.includes(t.shelf))
    .map((t) => {
      const params = Object.entries(t.params)
        .map(([k, p]) => `${k}${"required" in p && p.required ? "*" : ""}${p.type === "enum" ? `(${p.values.join("|")})` : ""}: ${p.hint}`)
        .join("; ");
      return `- ${t.name} — ${t.title}. ${t.use} Длительность ${t.duration.min}–${t.duration.max} с. Параметры: ${params}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Plan validation: the model makes mistakes; the checker fixes what it can and reports the rest.

export type Scene = { tool: string; duration: number; transition: string; params: Record<string, unknown> };
export type Plan = { title: string; scenes: Scene[] };
export type Checked = { plan: Plan; fixes: string[]; errors: string[]; seconds: number };

/** Breaks a too-long line at spaces so it fits; keeps the model's own line breaks. */
export function wrapLines(text: string, perLine: number, maxLines: number): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.trim().split(/\s+/).filter(Boolean)) {
      const plain = (s: string) => s.replace(/\*/gu, "");
      if (line && plain(`${line} ${word}`).length > perLine) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out.slice(0, maxLines).join("\n");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\\n/gu, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/gu, "").trim() : "";
}

function checkParam(key: string, spec: ParamSpec, value: unknown, where: string, fixes: string[]): unknown {
  switch (spec.type) {
    case "text": {
      let text = cleanText(value);
      if (!text) return undefined;
      const perLine = spec.maxLines && spec.maxLines > 1 ? Math.max(8, Math.ceil(spec.max / spec.maxLines) + 4) : spec.max;
      if (spec.maxLines && spec.maxLines > 1) {
        const wrapped = wrapLines(text, perLine, spec.maxLines);
        if (wrapped !== text) fixes.push(`${where}.${key}: перенёс строки`);
        text = wrapped;
      }
      if (text.replace(/\*/gu, "").length > spec.max + (spec.maxLines ?? 1)) {
        text = text.slice(0, spec.max).trim();
        fixes.push(`${where}.${key}: сократил до ${spec.max} знаков`);
      }
      // An unmatched * would show up as a star on screen.
      if ((text.match(/\*/gu) || []).length % 2) text = text.replace(/\*/gu, "");
      return text;
    }
    case "number": {
      const n = Number(value);
      if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return undefined;
      const c = Math.min(spec.max, Math.max(spec.min, n));
      if (c !== n) fixes.push(`${where}.${key}: ${n} → ${c}`);
      return c;
    }
    case "enum": {
      const v = typeof value === "string" ? value : "";
      if (!v) return undefined;
      if (!spec.values.includes(v)) {
        fixes.push(`${where}.${key}: «${v}» нет, поставил «${spec.default}»`);
        return spec.default;
      }
      return v;
    }
    case "list": {
      if (!Array.isArray(value)) return undefined;
      const items = value.map(cleanText).filter(Boolean).map((s) => s.slice(0, spec.maxLength));
      if (items.length > spec.maxItems) fixes.push(`${where}.${key}: оставил ${spec.maxItems} пункта`);
      return items.slice(0, spec.maxItems);
    }
    case "messages": {
      if (!Array.isArray(value)) return undefined;
      const items = value
        .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : null))
        .filter((m): m is Record<string, unknown> => Boolean(m && cleanText(m.text)))
        .map((m) => ({ from: m.from === "client" ? "client" : "me", text: cleanText(m.text).slice(0, spec.maxLength) }));
      if (items.length > spec.maxItems) fixes.push(`${where}.${key}: оставил ${spec.maxItems} сообщения`);
      return items.slice(0, spec.maxItems);
    }
    case "url": {
      const v = typeof value === "string" ? value.trim() : "";
      if (!v) return undefined;
      if (!/^https:\/\/[^\s"'<>]+$/iu.test(v)) {
        fixes.push(`${where}.${key}: убрал непонятную ссылку`);
        return undefined;
      }
      return v;
    }
    case "box": {
      if (!value || typeof value !== "object") return undefined;
      const b = value as Record<string, unknown>;
      const n = (v: unknown, d: number) => Math.min(100, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : d));
      return { x: n(b.x, 20), y: n(b.y, 15), w: n(b.w, 60), h: n(b.h, 18) };
    }
  }
}

/** Checks and repairs a plan the model wrote. Unknown tools are dropped; numbers are clamped. */
export function checkPlan(raw: unknown): Checked {
  const fixes: string[] = [];
  const errors: string[] = [];
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawScenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (!rawScenes.length) errors.push("в плане нет сцен");
  const scenes: Scene[] = [];

  rawScenes.slice(0, MAX_SCENES + 4).forEach((item, i) => {
    const s = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const where = `сцена ${i + 1}`;
    const spec = toolSpec(String(s.tool ?? ""));
    if (!spec) {
      fixes.push(`${where}: инструмента «${String(s.tool ?? "")}» нет — сцена убрана`);
      return;
    }
    const params: Record<string, unknown> = {};
    const given = s.params && typeof s.params === "object" ? (s.params as Record<string, unknown>) : {};
    for (const [key, p] of Object.entries(spec.params)) {
      const v = checkParam(key, p, given[key], where, fixes);
      if (v !== undefined) params[key] = v;
      else if ("required" in p && p.required) errors.push(`${where} (${spec.name}): нет «${key}»`);
    }
    for (const key of Object.keys(given)) if (!(key in spec.params)) fixes.push(`${where}: лишний параметр «${key}» убран`);
    let duration = Number(s.duration);
    if (!Number.isFinite(duration)) duration = spec.duration.default;
    const clamped = Math.min(spec.duration.max, Math.max(spec.duration.min, duration));
    if (clamped !== duration && Number.isFinite(Number(s.duration))) fixes.push(`${where}: длительность ${duration} → ${clamped} с`);
    let transition = typeof s.transition === "string" && (TRANSITIONS as readonly string[]).includes(s.transition) ? s.transition : "cut";
    if (scenes.length === 0) transition = "cut";
    scenes.push({ tool: spec.name, duration: Math.round(clamped * 10) / 10, transition, params });
  });

  if (scenes.length > MAX_SCENES) {
    fixes.push(`сцен больше ${MAX_SCENES} — лишние убраны`);
    scenes.length = MAX_SCENES;
  }
  // The outro belongs at the end.
  const outro = scenes.findIndex((s) => s.tool === "outro");
  if (outro >= 0 && outro !== scenes.length - 1) {
    scenes.push(scenes.splice(outro, 1)[0]);
    fixes.push("концовку перенёс в конец");
  }
  const seconds = scenes.reduce((n, s) => n + s.duration, 0);
  if (seconds > MAX_SECONDS) errors.push(`ролик ${seconds.toFixed(1)} с — длиннее ${MAX_SECONDS} с`);
  const title = cleanText(input.title).slice(0, 80) || "Рилс";
  return { plan: { title, scenes }, fixes, errors, seconds };
}
