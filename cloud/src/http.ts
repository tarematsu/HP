const FETCH_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = MAX_ATTEMPTS,
): Promise<Response> {
  let lastError: unknown;
  const totalAttempts = Math.max(1, Math.trunc(attempts));
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const controller = new AbortController();
    const callerSignal = init.signal;
    const abortFromCaller = (): void => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    let terminalError: Error | null = null;
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("User-Agent")) headers.set("User-Agent", "HomePanel/2.0 (+Cloudflare Worker)");
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-cache, no-store, max-age=0");
      if (!headers.has("Pragma")) headers.set("Pragma", "no-cache");
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (response.ok) return response;
      const error = new Error(`${response.status} ${response.statusText}`);
      await response.body?.cancel();
      if (!retryableStatus(response.status) || attempt + 1 >= totalAttempts) terminalError = error;
      else lastError = error;
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      lastError = error;
      if (attempt + 1 >= totalAttempts) terminalError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
    if (terminalError) throw terminalError;
    await sleep(200 + attempt * 300);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  return fetchWithRetry(url, init).then(response => response.json() as Promise<T>);
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  return fetchWithRetry(url, init).then(response => response.text());
}
