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
  before?: string[];
  /** The owner's own picture (https), for «фото», «товар», «экран». */
  image?: string;
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
  "печать": { tool: "typewriter", hint: "фраза печатается с курсором, как будто ИИнна пишет: text" },
  "до/после": { tool: "compare", hint: "сверху проблемы без ИИнны, снизу решения с ней: before (2–3 пункта), items (2–3 пункта)" },
  "бегущая строка": { tool: "ticker", hint: "1–3 слова бегут лентами через экран: text" },
  "завал": { tool: "pile", hint: "сообщения клиентов сыпятся кучей: text — заголовок, items — 2–4 коротких вопроса клиентов" },
  "ночь": { tool: "night", hint: "часы бегут через ночь до рассвета: text («Пока вы *спите*»), label" },
  "смена слов": { tool: "swap", hint: "«ИИнна» и прокручивающиеся глаголы: text — начало, items — 2–5 слов" },
  "реакция": { tool: "burst", hint: "слово с салютом из сердечек и звёзд: text (1–2 слова), label" },
  "фото": { tool: "photo", hint: "своё фото или скриншот владельца: image, text — надпись" },
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
      const before = Array.isArray(s.before) ? s.before.map((i) => str(i, 40)).filter(Boolean).slice(0, 3) : undefined;
      if (before?.length) scene.before = before;
      const image = str(s.image, 600);
      if (/^https:\/\/[^\s"'<>]+$/iu.test(image)) scene.image = image;
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
/** Deterministic random numbers from a seed (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLE_BPM: Record<string, number> = { pulse: 120, bounce: 140, chill: 92 };

/**
 * Looks: whole-reel directions. Each one sets the theme, music, the family of transitions and
 * camera moves, the layouts it prefers and which creative tools may stand in for a plain headline.
 * The studio shows three different looks at once, so the variants never resemble each other.
 */
export type Look = {
  id: string;
  name: string;
  theme: string;
  style: string;
  moves: string[];
  cameras: string[];
  headline: string[];
  phone: number;
  alt: Record<string, number>;
};
export const LOOKS: Look[] = [
  { id: "punch", name: "Удар", theme: "brand", style: "bounce", moves: ["whip", "slab", "glitch", "split", "push"], cameras: ["push", "panL", "panR", "tilt"], headline: ["block", "giant"], phone: 0.3, alt: { ticker: 0.45 } },
  { id: "night", name: "Ночь", theme: "night", style: "chill", moves: ["fade", "zoom", "iris", "slide"], cameras: ["drift", "pull", "push"], headline: ["stack", "block"], phone: 0.85, alt: { typewriter: 0.5 } },
  { id: "paper", name: "Журнал", theme: "mono", style: "pulse", moves: ["wipe", "push", "split", "slide"], cameras: ["still", "drift", "panR"], headline: ["stack", "giant"], phone: 0.2, alt: { typewriter: 0.3 } },
  { id: "acid", name: "Кислота", theme: "acid", style: "bounce", moves: ["glitch", "whip", "zoom", "slab"], cameras: ["push", "tilt", "panL"], headline: ["giant", "block"], phone: 0.5, alt: { ticker: 0.5 } },
  { id: "cinema", name: "Кино", theme: "cinema", style: "pulse", moves: ["fade", "iris", "zoom", "wipe"], cameras: ["push", "pull", "drift"], headline: ["stack"], phone: 0.6, alt: { typewriter: 0.4 } },
];

/** Music style from the tone of the script: calm tutorials get "chill", bold ones "bounce". */
export function pickStyle(script: Script, rand: () => number): string {
  const text = `${script.title} ${script.idea} ${script.scenes.map((s) => s.text).join(" ")}`.toLowerCase();
  if (/(шаг|обуча|как подключ|настро|спокойн|инструкц)/u.test(text)) return "chill";
  if (/(дерз|стоп|нет\.|скидк|быстр|!)/u.test(text) && rand() < 0.7) return "bounce";
  return ["pulse", "bounce", "chill"][Math.floor(rand() * 3)];
}

/**
 * Turns the script into a plan by fixed rules and runs the plan checker over it. `seed` makes each
 * build look different (layouts, transitions, cameras, music) while staying reproducible.
 */
export function scriptToPlan(
  script: Script,
  seed = hashSeed(script.title),
  opts: { style?: string; look?: string; bpm?: number; theme?: string; logo?: string } = {},
): Checked {
  const rand = random(seed);
  const look = LOOKS.find((l) => l.id === opts.look) ?? LOOKS[seed % LOOKS.length];
  const pick = <T,>(items: T[], avoid?: T): T => {
    const pool = items.filter((x) => x !== avoid);
    const from = pool.length ? pool : items;
    return from[Math.floor(rand() * from.length)];
  };
  const auto = opts.look ? look.style : pickStyle(script, rand);
  const style = opts.style && STYLE_BPM[opts.style] ? opts.style : auto;
  // An own music track brings its own tempo; cuts snap to it.
  const bpm = opts.bpm && opts.bpm >= 70 && opts.bpm <= 170 ? Math.round(opts.bpm) : STYLE_BPM[style];
  const beat = 60 / bpm;
  // Scene lengths snap to whole beats, so every cut lands on the music.
  const onBeat = (sec: number, minBeats: number) => Math.round(Math.max(minBeats, Math.round(sec / beat)) * beat * 100) / 100;
  const scenes: Scene[] = [];
  // In the paper look "black" is drawn as paper too, so it alternates paper with ink blocks instead.
  const cycle = look.theme === "mono" ? ["cream", "violet"] : ["cream", "black", "violet"];
  const moves = look.moves;
  let lastBg = "";
  let lastMove = "";
  let lastHeadline = "";
  const pickBg = (preferred: string[]) => {
    const pref = look.theme === "mono" ? preferred.map((b) => (b === "black" ? "violet" : b)) : preferred;
    return pref.find((b) => b !== lastBg) ?? cycle.find((b) => b !== lastBg) ?? "cream";
  };
  let lastTool = "";

  // Scenes that would come out empty are dropped instead of drawing a placeholder.
  const list = keptScenes(script).map((i) => script.scenes[i]);
  const screens = list.filter((s) => s.kind === "экран").length;
  let screenNo = 0;
  if (!list.length || list[list.length - 1].kind !== "концовка") {
    list.push({ seconds: 2.6, kind: "концовка", text: "Ссылка в профиле", what: "" });
  }

  list.forEach((s, i) => {
    let tool = KINDS[s.kind]?.tool ?? "headline";
    // A plain headline may become one of the look's creative tools (never the same tool twice in a row).
    if (tool === "headline" && i > 0) {
      for (const [alt, chance] of Object.entries(look.alt)) {
        if (alt === "ticker" && words(s.text || s.what) > 3) continue;
        if (alt !== lastTool && rand() < chance) { tool = alt; break; }
      }
    }
    const text = s.text || s.what;
    const client = s.lines?.filter((l) => l.from === "client") ?? [];
    const inna = s.lines?.filter((l) => l.from === "inna") ?? [];
    let params: Record<string, unknown> = {};
    let bg = "";
    switch (tool) {
      case "headline":
        bg = pickBg(cycle);
        {
          const fits = words(text) <= 3 ? ["stack", "block", "giant"] : /\*/u.test(text) ? ["stack", "block"] : ["stack"];
          const liked = fits.filter((v) => look.headline.includes(v));
          const options = liked.length ? liked : fits;
          const variant = pick(options, lastHeadline);
          lastHeadline = variant;
          params = { text, align: "center", size: words(text) <= 3 ? "xl" : "l", variant };
        }
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
        params = { value: s.number || (plain(text).match(/[\d/ ]+/u)?.[0]?.trim() ?? "24/7"), headline: s.number ? text : "", label: s.label ?? "", variant: look.id === "paper" ? "corner" : rand() < 0.5 ? "ring" : "corner" };
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
          variant: rand() < look.phone ? "phone" : "float",
          headline: text || "Новый\n*заказ*",
          title: s.title || (/заказ/iu.test(text) || !text ? "Пришёл новый заказ" : plain(text)),
          body: s.body ?? "",
          app: "Telegram",
        };
        break;
      case "chat":
        bg = pickBg(["cream", "black"]);
        params = {
          ...(rand() < look.phone ? { variant: "phone", title: text } : {}),
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
        params = { headline: text, name: s.name || "Товар", price: s.price ?? "", caption: s.label ?? "", ...(s.image ? { image: s.image } : {}) };
        break;
      case "screen":
        bg = "black";
        screenNo += 1;
        params = { title: s.section || plain(text), subtitle: s.label ?? "", step: `${String(screenNo).padStart(2, "0")} / ${String(screens).padStart(2, "0")}`, note: s.question ?? "", ...(s.image ? { image: s.image } : {}) };
        break;
      case "badge":
        bg = "cream";
        params = { headline: text || "*Ваш*\nличный\nменеджер" };
        break;
      case "typewriter":
        bg = pickBg(["black", "cream", "violet"]);
        params = { text: text || "Сейчас отвечу…", label: s.label ?? "" };
        break;
      case "compare":
        bg = look.theme === "mono" ? "cream" : "black";
        params = {
          before: s.before?.length ? s.before : ["Ответ через час", "Потерянные заявки"],
          after: s.items?.length ? s.items : ["Ответ сразу", "Заказ оформлен"],
          ...(s.label ? { right: s.label } : {}),
        };
        break;
      case "ticker":
        bg = pickBg(["cream", "violet", "black"]);
        params = { text: plain(text) || "24/7" };
        break;
      case "pile":
        bg = pickBg(["cream", "black"]);
        params = { headline: text || "Директ\n*разрывается*", messages: s.items?.length ? s.items : client.map((l) => l.text).slice(0, 4) };
        break;
      case "night":
        bg = "black";
        params = { text: text || "Пока вы *спите*", label: s.label || "ИИнна на связи" };
        break;
      case "swap":
        bg = pickBg(["violet", "black"]);
        params = { prefix: plain(text) || "ИИнна", words: s.items?.length ? s.items : ["отвечает", "продаёт", "напоминает"] };
        break;
      case "burst":
        bg = pickBg(["violet", "black"]);
        params = { text: plain(text) || "Заказ!", label: s.label ?? "", shape: pick(["mix", "heart", "star", "spark"]) };
        break;
      case "photo":
        bg = pickBg(["black", "cream"]);
        params = {
          image: s.image ?? "",
          text,
          label: s.label ?? "",
          variant: { night: "phone", paper: "card", punch: "full", acid: pick(["full", "card"]), cinema: "full" }[look.id] ?? "full",
        };
        break;
      case "outro":
        bg = lastBg === "violet" ? "black" : "violet";
        params = { brand: "ИИнна", cta: plain(text) || "Ссылка в профиле", line: s.label || "", ...(opts.logo || s.image ? { logo: opts.logo || s.image } : {}) };
        break;
    }
    if (["headline", "slam", "glitch", "counter", "chat", "choice", "list", "product", "outro", "typewriter", "compare", "ticker", "pile", "swap", "burst", "photo"].includes(tool)) params.bg = bg;
    // Cuts for hard hits, varied moves for the rest, an iris into the ending.
    let transition = "cut";
    if (i > 0) {
      if (tool === "outro") transition = pick(["iris", "slab", "zoom"], lastMove);
      else if (tool === "slam" || tool === "glitch" || tool === "burst") transition = pick(["cut", "glitch"], lastMove);
      else if (scenes[i - 1]?.tool === "slam") transition = pick(["slab", "whip", "split"], lastMove);
      else transition = pick(moves, lastMove);
      if (transition !== "cut") lastMove = transition;
    }
    lastBg = bg;
    lastTool = tool;
    const minBeats = tool === "slam" ? 2 : tool === "glitch" ? 3 : 4;
    scenes.push({ tool, duration: onBeat(s.seconds, minBeats), transition, camera: pick(look.cameras), params });
  });
  return checkPlan({ title: script.title, scenes, style, bpm, seed, theme: opts.theme || look.theme });
}

/** Script scenes that become plan scenes (empty ones are dropped). */
function keptScenes(script: Script): number[] {
  const out: number[] = [];
  script.scenes.forEach((s, i) => {
    if (s.kind === "товар" && !s.name) return;
    if (["надпись", "удар", "сомнение"].includes(s.kind) && !plain(s.text || s.what)) return;
    out.push(i);
  });
  return out;
}

/**
 * For each plan scene, the index of the script scene it came from (-1 for the ending added
 * automatically). Lets the studio edit the script from the storyboard.
 */
export function planSources(script: Script): number[] {
  const kept = keptScenes(script);
  const last = kept.length ? script.scenes[kept[kept.length - 1]] : null;
  return last && last.kind === "концовка" ? kept : [...kept, -1];
}

/** Stable seed from text, used when the caller does not pass one. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 1_000_000;
}
