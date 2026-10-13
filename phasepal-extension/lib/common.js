// Shared helpers for hstry sync providers.

let partCounter = 0;

export function textPart(text) {
  return { id: `p-${++partCounter}`, type: 'text', text };
}

export function thinkingPart(text) {
  return { id: `p-${++partCounter}`, type: 'thinking', text };
}

export function toolCallPart(toolCallId, name, input) {
  return { id: `p-${++partCounter}`, type: 'tool_call', toolCallId, name, input };
}

export function toolResultPart(toolCallId, output) {
  return { id: `p-${++partCounter}`, type: 'tool_result', toolCallId, output };
}

export class NotLoggedInError extends Error {
  constructor(service) {
    super(`${service}: not logged in`);
    this.name = 'NotLoggedInError';
  }
}

export function sleep(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
    signal?.addEventListener('abort', cancel, {once: true});
  });
}

/** Cap retries below Chrome's service-worker inactivity window. */
const MAX_BACKOFF_MS = 20_000;

/**
 * GET/POST JSON with optional bounded retry-and-backoff on rate limits (429)
 * and transient server errors (502/503). The collector defers retries to its
 * next alarm so the service worker can stop. Honors `Retry-After` when present,
 * otherwise uses exponential backoff with jitter. 401/403 fail fast as
 * "not logged in" — retrying those is pointless.
 */
export async function fetchJson(url, init = {}, { retries = 0, baseDelayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
    const res = await fetch(url, { credentials: 'include', ...init, signal });

    if (res.status === 401 || res.status === 403) {
      throw new NotLoggedInError(new URL(url).hostname);
    }

    if (res.status === 429 || res.status === 502 || res.status === 503) {
      if (attempt >= retries) {
        throw new RateLimitedError(`${init.method ?? 'GET'} ${url} -> ${res.status} (gave up after ${retries} retries)`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const headerMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
      const backoffMs = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 500);
      await sleep(Math.min(MAX_BACKOFF_MS, Math.max(headerMs, backoffMs)), init.signal);
      continue;
    }

    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${url} -> ${res.status}`);
    }
    return res.json();
  }
}

export class RateLimitedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Unix seconds (possibly fractional) vs milliseconds.
    return Math.floor(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function shortId(id) {
  return String(id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
}

// Safe summaries only: provider errors can contain private conversation URLs.
export function syncError(error) {
  if (error instanceof NotLoggedInError) return 'Sign in to the source website in Chrome, then retry.';
  if (error instanceof RateLimitedError) return 'The source is rate limited or temporarily unavailable. Wait a minute, then retry.';
  if (error?.name === 'TimeoutError') return 'The source request timed out. Check your connection, then retry.';
  return 'A conversation could not be read. Open the source website, then retry.';
}
