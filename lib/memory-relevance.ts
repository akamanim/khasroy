export type RankableKnowledge = {
  memory_key: string;
  category: string;
  content: string;
  confidence: number;
  updated_at: string;
};

/**
 * Operational records (job state, audit logs, image-exam lessons) are stored in the
 * same knowledge table as owner facts. They are useful to the subsystems that wrote
 * them, but injecting them into every chat prompt crowds out what the owner actually
 * told Khasroy. They only reach a chat prompt when the question clearly matches them.
 */
const OPERATIONAL_CATEGORY =
  /^(site_agent|site-agent|site-audit|site_audit|website_audit|image_generation|vision_school|system_capability|web_studio)/iu;
const OWNER_CATEGORY = /^owner/iu;
const OPERATIONAL_MIN_OVERLAP = 2;

function stems(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return new Set(words.map((word) => word.slice(0, 5)));
}

function overlap(query: Set<string>, text: string): number {
  if (!query.size) return 0;
  let hits = 0;
  for (const stem of stems(text)) if (query.has(stem)) hits++;
  return hits;
}

export function isOperationalKnowledge(category: string): boolean {
  return OPERATIONAL_CATEGORY.test(category);
}

/**
 * Picks the knowledge worth putting into a chat prompt for this query:
 * owner facts first, then anything that shares words with the question,
 * operational logs only on a strong match. Newer entries win ties.
 */
export function rankKnowledgeForChat<T extends RankableKnowledge>(
  items: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const queryStems = stems(query);
  return items
    .map((item) => {
      const hits = overlap(queryStems, `${item.memory_key} ${item.category} ${item.content}`);
      const operational = isOperationalKnowledge(item.category);
      const owner = OWNER_CATEGORY.test(item.category);
      const eligible = operational ? hits >= OPERATIONAL_MIN_OVERLAP : owner || hits > 0;
      const time = Date.parse(item.updated_at);
      return {
        item,
        eligible,
        score: hits * 2 + (owner ? 3 : 0) + Math.max(0, Math.min(1, item.confidence)),
        time: Number.isFinite(time) ? time : 0,
      };
    })
    .filter((entry) => entry.eligible)
    .sort((a, b) => b.score - a.score || b.time - a.time)
    .slice(0, limit)
    .map((entry) => entry.item);
}

const PREFERENCE_SIGNAL =
  /(я предпочитаю|предпочитаю,? чтобы|мне не нравится|мне нравится|не люблю,? когда|всегда (делай|пиши|отвечай|используй)|никогда не (делай|пиши|используй)|не используй|называй меня|меня зовут|по умолчанию (делай|используй))/iu;

/** Detects a durable owner preference worth remembering without an explicit "запомни". */
export function looksLikeOwnerPreference(text: string): boolean {
  return text.length <= 1200 && PREFERENCE_SIGNAL.test(text);
}
