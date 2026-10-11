// Safety rules for the cloud browser: which addresses it may open and which clicks need the
// owner's confirmation. Pure functions, covered by tests/cloud-browser.mjs.

/** Adds https:// when the owner types a bare domain; returns null for anything that is not a web page. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/iu.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function privateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/gu, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/u.test(h) || /^fe[89ab]/u.test(h)) return true;
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(h);
  return mapped ? privateIPv4(mapped[1]) : false;
}

/** True for hosts that point inside the server's own network (localhost, private ranges, cloud metadata). */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  return privateIPv4(host) || privateIPv6(host);
}

/** Checks the address and, when possible, what its name resolves to. */
export async function assertPublicUrl(url: string, lookup?: (host: string) => Promise<string[]>): Promise<void> {
  const { hostname } = new URL(url);
  if (isPrivateHost(hostname)) throw new Error("Этот адрес ведёт во внутреннюю сеть — браузер его не открывает.");
  if (!lookup) return;
  const addresses = await lookup(hostname).catch(() => [] as string[]);
  if (addresses.some(isPrivateHost)) throw new Error("Этот адрес ведёт во внутреннюю сеть — браузер его не открывает.");
}

// Buttons whose click spends money, sends something or signs in: the agent stops and asks first.
const RISKY = /(купить|оплат|оформ|заказ|корзин|checkout|pay|buy|purchase|order|отправ|submit|send|подтверд|confirm|войти|вход|login|log in|sign in|sign up|регистр|подпис|subscribe|удал|delete|перевод|transfer)/iu;

export function isRiskyLabel(label: string): boolean {
  return RISKY.test(label);
}

/** Fields the agent never types into, even with confirmation: passwords and payment data. */
export function isSecretField(type: string, name: string): boolean {
  return /password/iu.test(type) || /(card|cc-|cvc|cvv|iban|passw|парол|карт)/iu.test(name);
}
