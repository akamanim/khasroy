import { NextResponse } from "next/server";
import { AllModelsLimitedError } from "@/lib/ai/limits";
import { buildPlan, writeScript } from "@/lib/reels/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Self-check of the reel writer on a fixed brief: script → plan → checker. Takes no input and saves
// nothing; throttled so it cannot be used to spend the model limits.
const BRIEFS = [
  "Рилс про то, что владелец больше не сидит в директе 24/7: 168 часов в неделе, а ИИнна отвечает за него, понимает голосовые, спрашивает про скидку кнопками Да/Нет и присылает заказ в Telegram.",
  "Рилс: клиент просит скидку, ИИнна спрашивает владельца кнопками Да/Нет. 15 секунд, дерзко.",
  "Рилс-обучалка: как подключить ИИнну за 3 шага — Товары и услуги, Настройки ИИ, Интеграции.",
];
let lastRun = 0;

export async function GET(request: Request) {
  if (Date.now() - lastRun < 60_000) return NextResponse.json({ ok: false, error: "too often" }, { status: 429 });
  lastRun = Date.now();
  const n = Math.min(BRIEFS.length - 1, Math.max(0, Number(new URL(request.url).searchParams.get("n")) || 0));
  const started = Date.now();
  try {
    const { script, model: scriptModel } = await writeScript(BRIEFS[n]);
    const scriptMs = Date.now() - started;
    const checked = await buildPlan(script);
    return NextResponse.json({
      ok: checked.errors.length === 0,
      brief: BRIEFS[n],
      scriptModel,
      planModel: checked.model,
      scriptMs,
      totalMs: Date.now() - started,
      script,
      errors: checked.errors,
      fixes: checked.fixes,
      seconds: checked.seconds,
      plan: checked.plan,
    });
  } catch (error) {
    if (error instanceof AllModelsLimitedError) return NextResponse.json({ ok: false, limited: true, retryAt: error.retryAt }, { status: 429 });
    return NextResponse.json({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 400) }, { status: 500 });
  }
}
