type ImageFetchState = {
  installed: boolean;
  originalFetch: typeof fetch;
};

const GLOBAL_KEY = "__khasroyImageFetchHardening";
const MSHOTS_HOST = "s.wordpress.com";
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = 18_000;

function state() {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let current = root[GLOBAL_KEY] as ImageFetchState | undefined;
  if (!current) {
    current = {
      installed: false,
      originalFetch: globalThis.fetch.bind(globalThis),
    };
    root[GLOBAL_KEY] = current;
  }
  return current;
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isMshots(input: RequestInfo | URL) {
  try {
    const url = new URL(requestUrl(input));
    return url.hostname === MSHOTS_HOST && url.pathname.startsWith("/mshots/v1/");
  } catch {
    return false;
  }
}

function browserHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Khasroy/1.0",
  );
  headers.set("Accept", "image/avif,image/webp,image/apng,image/png,image/jpeg,*/*;q=0.8");
  return headers;
}

function signal(init?: RequestInit) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  if (!init?.signal) return timeout;
  try {
    return AbortSignal.any([init.signal, timeout]);
  } catch {
    return init.signal;
  }
}

async function attempt(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  return fetcher(input, {
    ...init,
    cache: "no-store",
    headers: browserHeaders(init),
    signal: signal(init),
  });
}

export function imageFetchHardeningInfo() {
  const current = state();
  return {
    installed: current.installed,
    mshotsRetryEnabled: true,
    timeoutMs: TIMEOUT_MS,
  };
}

export function installImageFetchHardening() {
  const current = state();
  if (current.installed) return imageFetchHardeningInfo();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isMshots(input)) return current.originalFetch(input, init);

    let first: Response | null = null;
    try {
      first = await attempt(current.originalFetch, input, init);
      if (first.ok || !RETRYABLE.has(first.status)) return first;
    } catch (error) {
      console.warn("Khasroy screenshot fetch first attempt failed", {
        category: error instanceof Error ? error.name : "fetch_error",
      });
    }

    await first?.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 450));

    try {
      const second = await attempt(current.originalFetch, input, init);
      if (!second.ok) {
        console.warn("Khasroy screenshot fetch retry rejected", {
          status: second.status,
        });
      }
      return second;
    } catch (error) {
      console.warn("Khasroy screenshot fetch retry failed", {
        category: error instanceof Error ? error.name : "fetch_error",
      });
      if (first) return first;
      throw error;
    }
  }) as typeof fetch;

  current.installed = true;
  return imageFetchHardeningInfo();
}
