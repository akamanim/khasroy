export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    );
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDuckDuckGoUrl(value: string) {
  const decoded = decodeHtml(value);

  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return decoded;
  }
}

export async function searchWebDirect(query: string, limit = 6) {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(target, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; KhasroyResearch/0.1; +https://khasroy.vercel.app)",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Direct web search failed (${response.status})`);
  }

  const html = await response.text();
  const blocks = html.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i).slice(1);
  const sources: WebSearchSource[] = [];

  for (const block of blocks) {
    if (sources.length >= limit) break;

    const anchor = block.match(
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!anchor) continue;

    const url = unwrapDuckDuckGoUrl(anchor[1]);
    if (!/^https?:\/\//i.test(url)) continue;

    const snippetMatch = block.match(
      /<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i,
    );

    const title = stripTags(anchor[2]);
    const snippet = stripTags(snippetMatch?.[1] || "");
    if (!title) continue;

    sources.push({ title, url, snippet });
  }

  if (!sources.length) {
    throw new Error("Direct web search returned no results");
  }

  const context = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}\nURL: ${source.url}\n${source.snippet || "(snippet unavailable)"}`,
    )
    .join("\n\n");

  return { sources, context };
}
