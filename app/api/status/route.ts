import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { getSkills } from "@/lib/server-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ownerKey = process.env.KHASROY_OWNER_KEY;
  if (!ownerKey) {
    return NextResponse.json({ error: "owner_not_configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(OWNER_COOKIE)?.value;
  if (!session || !safeEqual(session, ownerSessionToken(ownerKey))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const skills = await getSkills(ownerKey);
    const verified = skills.filter((skill) => skill.status === "verified");
    const has = (slug: string) => verified.some((skill) => skill.slug === slug);

    const repository = has("github_self_repository_reader");
    const sandbox = has("cloud_code_sandbox");
    const critic = has("independent_response_critic");

    return NextResponse.json({
      level: Math.max(1, verified.length),
      skills: verified.length,
      testsPassed: verified.reduce(
        (sum, skill) => sum + Math.max(Number(skill.tests_passed) || 0, 0),
        0,
      ),
      capabilities: {
        intelligence: has("live_ai_dialogue") ? 1 : 0,
        security: has("owner_access_control") ? 1 : 0,
        code: (repository ? 1 : 0) + (sandbox ? 1 : 0),
        memory: has("long_term_memory") ? 1 : 0,
        internet: has("internet_research") ? 1 : 0,
        vision: 0,
        voice: 0,
        agents: critic ? 1 : 0,
        images: 0,
      },
      modules: {
        memory: has("long_term_memory") ? "VERIFIED" : "LOCKED",
        github: repository ? "VERIFIED" : "LOCKED",
        internet: has("internet_research") ? "VERIFIED" : "LOCKED",
        sandbox: sandbox ? "VERIFIED" : "LOCKED",
        critic: critic ? "VERIFIED" : "LOCKED",
      },
      verifiedSkills: verified.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        level: skill.level,
        testsPassed: skill.tests_passed,
      })),
    });
  } catch (error) {
    console.error("Khasroy status read failed", error);
    return NextResponse.json({ error: "status_unavailable" }, { status: 502 });
  }
}
