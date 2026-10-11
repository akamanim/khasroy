import { NextResponse } from "next/server";
import { launch } from "@/lib/browser/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

let lastRun = 0;

/** Public self-check: can this deployment start Chromium and open a fixed page? No input is accepted. */
export async function GET() {
  if (Date.now() - lastRun < 10_000) return NextResponse.json({ ok: false, error: "too often" }, { status: 429 });
  lastRun = Date.now();
  const started = Date.now();
  let browser: Awaited<ReturnType<typeof launch>> | null = null;
  try {
    browser = await launch();
    const launchedMs = Date.now() - started;
    const page = await browser.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 15_000 });
    const title = await page.title();
    return NextResponse.json({ ok: true, title, launchedMs, totalMs: Date.now() - started, version: await browser.version() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 400) }, { status: 500 });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
