// Cloud browser engine: a headless Chromium (@sparticuz/chromium) driven by puppeteer-core inside
// a Vercel function. A function cannot keep a browser alive between requests, so the session lives
// in BrowserState (address, scroll position, cookies) and each request reopens it from there.

import { lookup } from "node:dns/promises";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { assertPublicUrl, isPrivateHost } from "@/lib/browser/guard";

export const VIEWPORT = { width: 1280, height: 800 };

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type BrowserState = { url: string; scrollY: number; cookies: StoredCookie[] };

export type PageElement = { i: number; tag: string; type: string; name: string; label: string; href: string; x: number; y: number };

export type Snapshot = {
  url: string;
  title: string;
  screenshot: string; // base64 JPEG, VIEWPORT size
  elements: PageElement[];
  text: string;
};

export const EMPTY_STATE: BrowserState = { url: "", scrollY: 0, cookies: [] };

const resolveAll = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

export async function launch(): Promise<Browser> {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    executablePath,
    headless: "shell",
  });
}

type CookieApi = {
  cookies?: () => Promise<StoredCookie[]>;
  setCookie?: (...cookies: StoredCookie[]) => Promise<void>;
};

/** Opens a tab with the session's cookies and blocks requests into private networks. */
export async function openPage(browser: Browser, state: BrowserState): Promise<Page> {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Khasroy",
  );
  await page.setExtraHTTPHeaders({ "accept-language": "ru-RU,ru;q=0.9,en;q=0.7" });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    try {
      const { protocol, hostname } = new URL(request.url());
      if ((protocol === "http:" || protocol === "https:") && isPrivateHost(hostname)) {
        void request.abort("blockedbyclient");
        return;
      }
    } catch {
      // data:, blob: and similar URLs are fine.
    }
    void request.continue();
  });
  const api = browser as unknown as CookieApi;
  if (state.cookies.length && api.setCookie) await api.setCookie(...state.cookies).catch(() => undefined);
  if (state.url) {
    await goto(page, state.url);
    if (state.scrollY > 0) {
      await page.evaluate(`window.scrollTo(0, ${Math.round(state.scrollY)})`);
      await sleep(300);
    }
  }
  return page;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lets the page finish what a click or navigation started, without waiting forever. */
export async function settle(page: Page) {
  await sleep(400);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => undefined);
}

export async function goto(page: Page, url: string) {
  await assertPublicUrl(url, resolveAll);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await settle(page);
}

// Runs inside the page: numbers the visible interactive elements and collects readable text.
const EXTRACT = `(() => {
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[onclick],summary';
  document.querySelectorAll('[data-khasroy-i]').forEach((e) => e.removeAttribute('data-khasroy-i'));
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.getAttribute('alt') || el.name || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 80);
    const i = out.length;
    el.setAttribute('data-khasroy-i', String(i));
    out.push({ i, tag: el.tagName.toLowerCase(), type: String(el.type || ''), name: String(el.name || el.autocomplete || ''), label,
      href: el.href ? String(el.href).slice(0, 140) : '', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    if (out.length >= 50) break;
  }
  const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 5000);
  return { elements: out, text };
})()`;

export async function snapshot(page: Page): Promise<Snapshot> {
  const url = page.url();
  if (!url || url === "about:blank") {
    return { url: "", title: "", screenshot: "", elements: [], text: "" };
  }
  const [title, extracted, screenshot] = await Promise.all([
    page.title().catch(() => ""),
    page.evaluate(EXTRACT).catch(() => ({ elements: [], text: "" })) as Promise<{ elements: PageElement[]; text: string }>,
    page.screenshot({ type: "jpeg", quality: 55, encoding: "base64" }) as Promise<string>,
  ]);
  return { url, title, screenshot, elements: extracted.elements, text: extracted.text };
}

export async function stateOf(browser: Browser, page: Page): Promise<BrowserState> {
  const api = browser as unknown as CookieApi;
  const cookies = api.cookies ? await api.cookies().catch(() => [] as StoredCookie[]) : [];
  const scrollY = Number(await page.evaluate("window.scrollY").catch(() => 0)) || 0;
  const url = page.url();
  return {
    url: url === "about:blank" ? "" : url,
    scrollY,
    cookies: cookies.slice(0, 80).map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
      secure: c.secure,
      httpOnly: c.httpOnly,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    })),
  };
}

export type ManualAction =
  | { kind: "goto"; url: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "clickIndex"; index: number; label?: string }
  | { kind: "type"; x?: number; y?: number; index?: number; text: string; enter?: boolean }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "back" }
  | { kind: "reload" };

async function pointOf(page: Page, index: number): Promise<{ x: number; y: number } | null> {
  const box = await page.evaluate(`(() => {
    const el = document.querySelector('[data-khasroy-i="${Math.trunc(index)}"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  return (box as { x: number; y: number } | null) ?? null;
}

export async function perform(page: Page, action: ManualAction) {
  switch (action.kind) {
    case "goto":
      await goto(page, action.url);
      return;
    case "click":
      await page.mouse.click(clamp(action.x, VIEWPORT.width), clamp(action.y, VIEWPORT.height));
      await settle(page);
      return;
    case "clickIndex": {
      // A reopened page has no numbers yet; number it again and prefer the element with the same label.
      const marked = (await page.evaluate(EXTRACT).catch(() => ({ elements: [] }))) as { elements: PageElement[] };
      const byLabel = action.label ? marked.elements.find((e) => e.label === action.label) : undefined;
      const point = await pointOf(page, byLabel ? byLabel.i : action.index);
      if (!point) throw new Error("Элемент на странице не найден — страница могла измениться.");
      await page.mouse.click(point.x, point.y);
      await settle(page);
      return;
    }
    case "type": {
      const point = typeof action.index === "number" ? await pointOf(page, action.index) : action.x !== undefined && action.y !== undefined ? { x: action.x, y: action.y } : null;
      if (point) await page.mouse.click(clamp(point.x, VIEWPORT.width), clamp(point.y, VIEWPORT.height), { clickCount: 3 });
      await page.keyboard.type(action.text.slice(0, 500), { delay: 15 });
      if (action.enter) await page.keyboard.press("Enter");
      await settle(page);
      return;
    }
    case "scroll":
      await page.evaluate(`window.scrollBy(0, ${action.direction === "down" ? 650 : -650})`);
      await sleep(350);
      return;
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await settle(page);
      return;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await settle(page);
  }
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max - 1, Math.round(Number(value) || 0)));
}
