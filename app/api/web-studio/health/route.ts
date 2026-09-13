import { NextResponse } from "next/server";
import { webStudioRuntimeStatus } from "@/lib/web-studio";
import { instagramRuntimeStatus } from "@/lib/social-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const web = webStudioRuntimeStatus();
  const instagram = instagramRuntimeStatus();
  return NextResponse.json({
    ok: true,
    service: "khasroy-web-studio",
    version: 1,
    websiteCompiler: true,
    projectStore: true,
    githubPublishing: web.githubConfigured,
    vercelPublishing: web.vercelConfigured,
    turnkeyPublishing: web.githubConfigured && web.vercelConfigured,
    socialDrafting: true,
    instagramPublishing: instagram.configured,
    fingerprint: web.fingerprint,
  });
}
