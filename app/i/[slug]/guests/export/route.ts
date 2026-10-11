import { ANSWER_LABEL, summarizeGuests } from "@/lib/invitations/guests";
import { loadManagedInvitation } from "@/lib/invitations/server";
import { buildXlsx } from "@/lib/xlsx-write";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = new URL(request.url).searchParams.get("k") ?? "";
  const managed = await loadManagedInvitation(slug, token);
  if (!managed) return new Response("Not found", { status: 404 });
  const summary = summarizeGuests(managed.rsvps);
  const rows: Array<Array<string | number>> = [
    ["Гость", "Ответ", "Человек", "Когда ответил"],
    ...summary.guests.map((g) => [
      g.name,
      ANSWER_LABEL[g.answer],
      g.people,
      new Date(g.at).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" }),
    ]),
    [],
    ["Итого придут", "", summary.people, ""],
  ];
  const file = buildXlsx("Гости", rows, [34, 20, 10, 22]);
  return new Response(file, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="guests-${slug}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
