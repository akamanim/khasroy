// Script → plan without a second model call. Khasroy writes the script from the studio's scene
// kinds (what can actually be drawn); this file turns each scene into a tool with parameters by
// fixed rules — colours, transitions and layout included. Pure functions, covered by tests/reels.mjs.

import { checkPlan, type Checked, type Scene } from "./catalog.ts";

export type Line = { from: "client" | "inna"; text: string };

export type ScriptScene = {
  seconds: number;
  kind: string;
  text: string;
  what: string;
  lines?: Line[];
  number?: string;
  label?: string;
  question?: string;
  items?: string[];
  name?: string;
  price?: string;
  section?: string;
  title?: string;
  body?: string;
};

export type Script = { title: string; idea: string; scenes: ScriptScene[] };

/** Scene kinds the writer may use, with the tool each becomes. */
export const KINDS: Record<string, { tool: string; hint: string }> = {
  "надпись": { tool: "headline", hint: "крупная мысль 2–5 слов" },
  "удар": { tool: "slam", hint: "одно слово на весь экран: «НЕТ.», «СТОП.», «ДА.»" },
  "сомнение": { tool: "glitch", hint: "тревожный вопрос 2–4 слова с цифровым сбоем" },
  "цифра": { tool: "counter", hint: "большая цифра: number («168», «24/7»), label — что это" },
  "часы": { tool: "dot_grid", hint: "сетка 7×24 точек — часы в неделе: number, label" },
  "уведомление": { tool: "notification", hint: "пуш на телефоне: title (заголовок пуша), body (строка под ним)" },
  "переписка": { tool: "chat", hint: "клиент пишет, ИИнна отвечает: lines" },
  "голосовое": { tool: "voice", hint: "голосовое клиента и ответ ИИнны: lines (1 клиент + 1 ИИнна)" },
  "выбор": { tool: "choice", hint: "вопрос владельцу и кнопки Да/Нет: question" },
  "список": { tool: "list", hint: "2–4 пункта с галочками: items" },
  "товар": { tool: "product", hint: "карточка товара: name, price (только если дано)" },
  "экран": { tool: "screen", hint: "раздел кабинета ИИнны: section" },
  "бейдж": { tool: "badge", hint: "бейдж «ИИнна — личный менеджер»" },
  "концовка": { tool: "outro", hint: "логотип и призыв; text — призыв" },
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Accepts the model's script and keeps only what the studio can use. */
export function cleanScript(raw: Record<string, unknown>): Script {
  const scenes: ScriptScene[] = (Array.isArray(raw.scenes) ? raw.scenes : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : null))
    .filter((s): s is Record<string, unknown> => Boolean(s && (str(s.text, 120) || str(s.what, 240))))
    .slice(0, 12)
    .map((s) => {
      const kind = str(s.kind, 20).toLowerCase();
      const lines = Array.isArray(s.lines)
        ? s.lines
            .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : null))
            .filter((l): l is Record<string, unknown> => Boolean(l && str(l.text, 160)))
            .slice(0, 4)
            .map((l) => ({ from: /client|клиент/iu.test(String(l.from)) ? ("client" as const) : ("inna" as const), text: str(l.text, 160) }))
        : undefined;
      const items = Array.isArray(s.items) ? s.items.map((i) => str(i, 40)).filter(Boolean).slice(0, 4) : undefined;
      const scene: ScriptScene = {
        seconds: Math.min(6, Math.max(1, Math.round((Number(s.seconds) || 2.5) * 10) / 10)),
        kind: KINDS[kind] ? kind : "надпись",
        text: str(s.text, 120),
        what: str(s.what, 240),
      };
      if (lines?.length) scene.lines = lines;
      if (items?.length) scene.items = items;
      for (const key of ["number", "label", "question", "name", "price", "section", "title", "body"] as const) {
        const v = str(s[key], 80);
        if (v) scene[key] = v;
      }
      return scene;
    });
  return { title: str(raw.title, 80) || "Рилс ИИнны", idea: str(raw.idea, 200), scenes };
}

const plain = (s: string) => s.replace(/\*/gu, "").trim();
const words = (s: string) => plain(s).split(/\s+/u).filter(Boolean).length;

/** Turns the script into a plan by fixed rules and runs the plan checker over it. */
export function scriptToPlan(script: Script): Checked {
  const scenes: Scene[] = [];
  const cycle = ["cream", "black", "violet"];
  const moves = ["slide", "wipe", "push", "zoom", "fade"];
  let lastBg = "";
  let moveIndex = 0;
  const pickBg = (preferred: string[]) => preferred.find((b) => b !== lastBg) ?? cycle.find((b) => b !== lastBg) ?? "cream";

  // Scenes that would come out empty are dropped instead of drawing a placeholder.
  const list = script.scenes.filter((s) => {
    if (s.kind === "товар") return Boolean(s.name);
    if (["надпись", "удар", "сомнение"].includes(s.kind)) return Boolean(plain(s.text || s.what));
    return true;
  });
  const screens = list.filter((s) => s.kind === "экран").length;
  let screenNo = 0;
  if (!list.length || list[list.length - 1].kind !== "концовка") {
    list.push({ seconds: 2.6, kind: "концовка", text: "Ссылка в профиле", what: "" });
  }

  list.forEach((s, i) => {
    const tool = KINDS[s.kind]?.tool ?? "headline";
    const text = s.text || s.what;
    const client = s.lines?.filter((l) => l.from === "client") ?? [];
    const inna = s.lines?.filter((l) => l.from === "inna") ?? [];
    let params: Record<string, unknown> = {};
    let bg = "";
    switch (tool) {
      case "headline":
        bg = pickBg(cycle);
        params = { text, align: "center", size: words(text) <= 3 ? "xl" : "l" };
        break;
      case "slam":
        bg = pickBg(["violet", "black"]);
        params = { text: plain(text).split(/\s+/u)[0] || "НЕТ." };
        break;
      case "glitch":
        bg = pickBg(["black", "cream"]);
        params = { text: plain(text) };
        break;
      case "counter":
        bg = pickBg(["black", "cream", "violet"]);
        params = { value: s.number || (plain(text).match(/[\d/ ]+/u)?.[0]?.trim() ?? "24/7"), headline: s.number ? text : "", label: s.label ?? "" };
        break;
      case "dot_grid": {
        bg = "cream";
        const n = Number(String(s.number ?? "").replace(/\D/gu, "")) || 168;
        params = { headline: text, number: n, label: s.label || "часов в неделе", filled: Math.min(1, n / 168), columns: 7, rows: 24 };
        break;
      }
      case "notification":
        bg = "black";
        params = {
          headline: text || "Новый\n*заказ*",
          title: s.title || (/заказ/iu.test(text) || !text ? "Пришёл новый заказ" : plain(text)),
          body: s.body ?? "",
          app: "Telegram",
        };
        break;
      case "chat":
        bg = pickBg(["cream", "black"]);
        params = {
          headline: text,
          messages: (s.lines?.length ? s.lines : [{ from: "client" as const, text: "Здравствуйте! Есть в наличии?" }, { from: "inna" as const, text: "Да, есть! Оформить?" }])
            .map((l) => ({ from: l.from === "client" ? "client" : "me", text: l.text })),
        };
        break;
      case "voice":
        bg = "black";
        params = { headline: plain(text).split(/\s+/u).slice(0, 2).join(" ") || "Слушаю", who: "Клиент", transcript: client[0]?.text ?? "", reply: inna[0]?.text ?? "" };
        break;
      case "choice":
        bg = pickBg(["cream", "black"]);
        params = { headline: text, question: s.question || plain(text), options: ["Да", "Нет"], pick: 0 };
        break;
      case "list":
        bg = pickBg(["black", "cream"]);
        params = { headline: text, items: s.items?.length ? s.items : [] };
        break;
      case "product":
        bg = pickBg(["cream", "black"]);
        params = { headline: text, name: s.name || "Товар", price: s.price ?? "", caption: s.label ?? "" };
        break;
      case "screen":
        bg = "black";
        screenNo += 1;
        params = { title: s.section || plain(text), subtitle: s.label ?? "", step: `${String(screenNo).padStart(2, "0")} / ${String(screens).padStart(2, "0")}`, note: s.question ?? "" };
        break;
      case "badge":
        bg = "cream";
        params = { headline: text || "*Ваш*\nличный\nменеджер" };
        break;
      case "outro":
        bg = lastBg === "violet" ? "black" : "violet";
        params = { brand: "ИИнна", cta: plain(text) || "Ссылка в профиле", line: s.label || "" };
        break;
    }
    if (["headline", "slam", "glitch", "counter", "chat", "choice", "list", "product", "outro"].includes(tool)) params.bg = bg;
    // Cuts for hard hits, varied moves for the rest, an iris into the ending.
    let transition = "cut";
    if (i > 0) {
      if (tool === "outro") transition = "iris";
      else if (tool === "slam" || tool === "glitch" || scenes[i - 1]?.tool === "slam") transition = tool === "slam" || tool === "glitch" ? "cut" : "wipe";
      else transition = moves[moveIndex++ % moves.length];
    }
    lastBg = bg;
    scenes.push({ tool, duration: s.seconds, transition, params });
  });
  return checkPlan({ title: script.title, scenes });
}
