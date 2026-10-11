import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/owner-session";
import { loadOwnerDashboard } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

/** Owner-only: statistics and real statuses for the console's side panels. */
export async function GET() {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ownerKey = process.env.KHASROY_OWNER_KEY?.trim() ?? "";
  try {
    return NextResponse.json(await loadOwnerDashboard(ownerKey));
  } catch (error) {
    console.error("Owner dashboard failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
