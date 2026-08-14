/**
 * Coerces whatever an API replied with into readable text.
 *
 * Route handlers reply `{ error: "message" }`, but a failure at the platform
 * level (function timeout, out-of-memory, oversized body) is answered by the
 * host before our code runs, in the shape `{ error: { code, message } }`.
 * Interpolating that gives "[object Object]" and hides the only clue there is,
 * so unpack the nested shape and never return a stringified object.
 */
export function errorText(payload: unknown, fallback: string): string {
  const raw =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error: unknown }).error
      : payload;

  if (typeof raw === 'string' && raw.trim()) return raw;

  if (raw && typeof raw === 'object') {
    const obj = raw as { code?: unknown; message?: unknown };
    const message = typeof obj.message === 'string' ? obj.message : null;
    const code = typeof obj.code === 'string' ? obj.code : null;
    if (message && code) return `${message} (${code})`;
    if (message) return message;
    if (code) return `${fallback} (${code})`;
  }

  return fallback;
}
