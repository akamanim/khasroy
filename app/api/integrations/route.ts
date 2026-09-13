import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import {
  deleteIntegration,
  listIntegrations,
  setIntegration,
  type IntegrationProvider,
} from "@/lib/server-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: IntegrationProvider[] = [
  "github",
  "vercel",
  "instagram",
  "groq",
  "openai",
  "gemini",
  "kimi",
];

async function auth() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
  if (!ownerKey) return { error: NextResponse.json({ error: "owner_not_configured" }, { status: 503 }) } as const;
  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  }
  return { ownerKey } as const;
}

function provider(value: unknown): IntegrationProvider | null {
  return typeof value === "string" && PROVIDERS.includes(value as IntegrationProvider)
    ? value as IntegrationProvider
    : null;
}

export async function GET() {
  const ctx = await auth();
  if ("error" in ctx) return ctx.error;
  const integrations = await listIntegrations(ctx.ownerKey);
  return NextResponse.json({
    ok: true,
    integrations,
    providers: PROVIDERS.map((id) => ({ id, configured: integrations.some((item) => item.provider === id) })),
  });
}

export async function POST(request: Request) {
  const ctx = await auth();
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => null) as {
    provider?: unknown;
    secret?: unknown;
    config?: unknown;
  } | null;
  const id = provider(body?.provider);
  const secret = typeof body?.secret === "string" ? body.secret.trim() : "";
  const config = body?.config && typeof body.config === "object" ? body.config as Record<string, unknown> : {};
  if (!id || secret.length < 8) return NextResponse.json({ error: "provider_and_secret_required" }, { status: 400 });
  const result = await setIntegration(ctx.ownerKey, id, secret, config);
  return NextResponse.json({ ok: true, integration: result.integration });
}

export async function DELETE(request: Request) {
  const ctx = await auth();
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => null) as { provider?: unknown } | null;
  const id = provider(body?.provider);
  if (!id) return NextResponse.json({ error: "provider_required" }, { status: 400 });
  await deleteIntegration(ctx.ownerKey, id);
  return NextResponse.json({ ok: true });
}
