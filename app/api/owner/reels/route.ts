import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { AllModelsLimitedError } from "@/lib/ai/limits";
import { getReel, listReels, queueReel, saveReel, type Script } from "@/lib/reels/server";
import { buildPlan, cleanScript, writeScript } from "@/lib/reels/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function failure(error: unknown) {
  // Out of model limits: the console waits and repeats the same step when they reset.
  if (error instanceof AllModelsLimitedError) {
    return NextResponse.json({ error: "Лимит моделей закончился", retryAt: error.retryAt }, { status: 429 });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message.slice(0, 300) }, { status: 502 });
}

export async function GET(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Только для владельца" }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) return NextResponse.json({ job: await getReel(id) });
    return NextResponse.json({ jobs: await listReels() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Только для владельца" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : undefined;
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 2000) : "";
  try {
    switch (body.action) {
      case "script": {
        if (!brief) return NextResponse.json({ error: "Напишите, о чём ролик" }, { status: 400 });
        const previous = body.previous && typeof body.previous === "object" ? cleanScript(body.previous as Record<string, unknown>) : undefined;
        const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 1000) : "";
        const { script, model } = await writeScript(brief, previous, feedback);
        const job = await saveReel({ id, brief, title: script.title, script });
        return NextResponse.json({ job, model });
      }
      case "plan": {
        // The owner may have edited the script by hand: that edited version is what gets built.
        const script = body.script && typeof body.script === "object" ? cleanScript(body.script as Record<string, unknown>) : null;
        if (!script || !script.scenes.length) return NextResponse.json({ error: "Нет сценария" }, { status: 400 });
        const checked = await buildPlan(script);
        if (checked.errors.length) {
          return NextResponse.json({ error: `План не собрался: ${checked.errors.join("; ")}`, fixes: checked.fixes }, { status: 422 });
        }
        const job = await saveReel({ id, brief: brief || undefined, title: script.title, script, plan: checked.plan });
        return NextResponse.json({ job, fixes: checked.fixes, seconds: checked.seconds, model: checked.model });
      }
      case "render": {
        if (!id) return NextResponse.json({ error: "Нет ролика" }, { status: 400 });
        return NextResponse.json({ job: await queueReel(id) });
      }
      case "save": {
        const script = body.script && typeof body.script === "object" ? (cleanScript(body.script as Record<string, unknown>) as Script) : undefined;
        return NextResponse.json({ job: await saveReel({ id, brief: brief || undefined, title: script?.title, script }) });
      }
      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (error) {
    return failure(error);
  }
}
