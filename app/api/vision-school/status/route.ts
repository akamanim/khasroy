import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerSessionToken, safeEqual } from "@/lib/server-auth";
import { getSkills } from "@/lib/server-memory";
import {
  PHOTO_GENERATION_CURRICULUM_VERSION,
  PHOTO_GENERATION_LESSONS,
  PHOTO_GENERATION_SKILL_SLUGS,
} from "@/lib/vision-school";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim();
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
    const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
    const lessons = PHOTO_GENERATION_LESSONS.map((lesson) => {
      const skill = bySlug.get(lesson.slug);
      return {
        slug: lesson.slug,
        level: lesson.level,
        name: lesson.name,
        objective: lesson.objective,
        status: skill?.status || "learning",
        testsPassed: skill?.tests_passed || 0,
        testsFailed: skill?.tests_failed || 0,
        metadata: skill?.metadata || {},
      };
    });

    const verified = lessons.filter((lesson) => lesson.status === "verified").length;
    const testsPassed = lessons.reduce((sum, lesson) => sum + lesson.testsPassed, 0);
    const testsFailed = lessons.reduce((sum, lesson) => sum + lesson.testsFailed, 0);

    return NextResponse.json({
      school: "Khasroy Vision School",
      track: "Photo Generation",
      curriculumVersion: PHOTO_GENERATION_CURRICULUM_VERSION,
      state: verified === PHOTO_GENERATION_SKILL_SLUGS.length ? "VERIFIED" : "LEARNING",
      level: Math.max(1, Math.min(8, verified + 1)),
      verifiedLessons: verified,
      totalLessons: PHOTO_GENERATION_SKILL_SLUGS.length,
      testsPassed,
      testsFailed,
      lessons,
    });
  } catch (error) {
    console.error("Vision School status read failed", error);
    return NextResponse.json({ error: "vision_school_unavailable" }, { status: 502 });
  }
}
