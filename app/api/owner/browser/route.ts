import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { runBrowserTask, type AgentEvent } from "@/lib/browser/agent";
import { EMPTY_STATE, launch, openPage, perform, snapshot, stateOf, visitForMedia, type BrowserState, type ManualAction } from "@/lib/browser/engine";
import { normalizeUrl } from "@/lib/browser/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function readState(raw: unknown): BrowserState {
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const r = raw as Partial<BrowserState>;
  const url = typeof r.url === "string" ? normalizeUrl(r.url) ?? "" : "";
  return {
    url,
    scrollY: Math.max(0, Math.min(200_000, Number(r.scrollY) || 0)),
    cookies: Array.isArray(r.cookies)
      ? r.cookies.filter((c) => c && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string").slice(0, 80)
      : [],
  };
}

function readAction(body: Record<string, unknown>): ManualAction {
  const num = (v: unknown) => Number(v) || 0;
  switch (body.action) {
    case "goto": {
      const url = normalizeUrl(String(body.url ?? ""));
      if (!url) throw new Error("Введите адрес сайта, например kelshi.kz");
      return { kind: "goto", url };
    }
    case "click":
      return typeof body.index === "number" ? { kind: "clickIndex", index: body.index, label: typeof body.label === "string" ? body.label : undefined } : { kind: "click", x: num(body.x), y: num(body.y) };
    case "type":
      return { kind: "type", x: num(body.x), y: num(body.y), text: String(body.text ?? ""), enter: Boolean(body.enter) };
    case "scroll":
      return { kind: "scroll", direction: body.direction === "up" ? "up" : "down" };
    case "back":
      return { kind: "back" };
    default:
      return { kind: "reload" };
  }
}

export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Только для владельца" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const state = readState(body.state);

  if (body.action === "gallery") {
    const sources = (Array.isArray(body.sources) ? body.sources : [])
      .map((item) => {
        const r = (item ?? {}) as { title?: unknown; url?: unknown };
        const url = typeof r.url === "string" ? normalizeUrl(r.url) : null;
        return url ? { title: typeof r.title === "string" ? r.title.slice(0, 200) : "", url } : null;
      })
      .filter((item): item is { title: string; url: string } => item !== null)
      .slice(0, 5);
    if (!sources.length) return NextResponse.json({ error: "Нет источников" }, { status: 400 });
    const encoder = new TextEncoder();
    const deadline = Date.now() + (maxDuration - 8) * 1000;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        let browser: Awaited<ReturnType<typeof launch>> | null = null;
        try {
          browser = await launch();
          const queue = sources.map((source, index) => ({ source, index }));
          // Two pages at a time: fast enough, and light on the function's memory.
          const worker = async () => {
            for (let job = queue.shift(); job; job = queue.shift()) {
              if (Date.now() > deadline) {
                send({ type: "skip", index: job.index, url: job.source.url, title: job.source.title, reason: "не хватило времени" });
                continue;
              }
              try {
                const card = await visitForMedia(browser!, job.source);
                send({ type: "card", index: job.index, source: job.source.url, ...card });
              } catch (error) {
                send({ type: "skip", index: job.index, url: job.source.url, title: job.source.title, reason: (error instanceof Error ? error.message : String(error)).slice(0, 160) });
              }
            }
          };
          await Promise.all([worker(), worker()]);
          send({ type: "done" });
        } catch (error) {
          send({ type: "error", message: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
        } finally {
          await browser?.close().catch(() => undefined);
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  }

  if (body.action === "task") {
    const goal = String(body.goal ?? "").trim().slice(0, 1000);
    if (!goal) return NextResponse.json({ error: "Напишите задачу" }, { status: 400 });
    const history = Array.isArray(body.history) ? body.history.filter((h): h is string => typeof h === "string").slice(-30) : [];
    const deadline = Date.now() + (maxDuration - 6) * 1000;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        await runBrowserTask({ goal, state, history, deadline, emit });
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  }

  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    const action = readAction(body);
    browser = await launch();
    // A fresh address does not need the previous page reopened first.
    const page = await openPage(browser, action.kind === "goto" ? { ...state, url: "" } : state);
    if (!(action.kind === "reload" && !state.url)) await perform(page, action);
    const snap = await snapshot(page);
    return NextResponse.json({ ...snap, state: await stateOf(browser, page) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 502 });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
