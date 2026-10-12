// When a free model runs out of its limit, Khasroy waits for the limit to reset instead of failing.
// These helpers work out *when* to try again from what the provider told us.

export class RateLimitError extends Error {
  readonly retryAt: number;
  readonly provider: string;
  constructor(provider: string, retryAt: number, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.provider = provider;
    this.retryAt = retryAt;
  }
}

/** Every model that could answer is out of its limit; the earliest one frees up at retryAt. */
export class AllModelsLimitedError extends Error {
  readonly retryAt: number;
  constructor(retryAt: number, message: string) {
    super(message);
    this.name = "AllModelsLimitedError";
    this.retryAt = retryAt;
  }
}

/** Parses provider durations such as "2m59.56s", "7.66s", "1h2m", "450ms" or plain seconds "12". */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/u.test(text)) return Math.round(Number(text) * 1000);
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/gu;
  let total = 0;
  let matched = false;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return matched ? Math.round(total) : null;
}

/** Start of the next UTC day: Cloudflare's free daily allowance resets then. */
export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** When the provider will accept requests again, with a small safety margin. */
export function retryAtFrom(headers: Headers, body: string, provider: string, now = Date.now()): number {
  const margin = 1500;
  if (provider === "cloudflare" && /daily|neuron|allocation/iu.test(body)) return nextUtcMidnight(now) + 60_000;
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = parseDuration(retryAfter);
    if (seconds !== null) return now + seconds + margin;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return date + margin;
  }
  const resets = [headers.get("x-ratelimit-reset-requests"), headers.get("x-ratelimit-reset-tokens")]
    .map(parseDuration)
    .filter((ms): ms is number => ms !== null);
  if (resets.length) return now + Math.max(...resets) + margin;
  return now + 60_000;
}

/** "через 2 мин 35 с" style countdown for the owner. */
export function waitLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}
