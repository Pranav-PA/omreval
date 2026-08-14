import { headers } from 'next/headers';

/**
 * Calls the Python (OpenCV) service.
 *
 * In production the functions live in the same Vercel deployment under
 * /api/py/*, so we resolve the current origin. For local `npm run dev` set
 * PYTHON_API_URL to the devserver.py address.
 */
async function baseUrl(): Promise<string> {
  const explicit = process.env.PYTHON_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  if (!host) throw new Error('Cannot resolve the image service URL.');
  return `${proto}://${host}`;
}

export class PyServiceError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Plain-English hints for the platform failures we can actually hit. */
const PLATFORM_HINTS: Record<string, string> = {
  FUNCTION_INVOCATION_TIMEOUT:
    'the image took too long to process. Try a smaller or less detailed photo.',
  FUNCTION_INVOCATION_FAILED:
    'the image processor ran out of memory or crashed on this image.',
  FUNCTION_PAYLOAD_TOO_LARGE:
    'the image is too large to send. Try a photo under about 3 MB.',
  EDGE_FUNCTION_INVOCATION_TIMEOUT:
    'the image took too long to process. Try a smaller photo.',
};

/**
 * Turns any error body into something a teacher can read.
 *
 * Our own handler replies `{"error": "message"}`, but a failure at the platform
 * level (timeout, out-of-memory, oversized body) never reaches our code and
 * replies `{"error": {"code": ..., "message": ...}}` instead. Stringifying that
 * naively yields "[object Object]" and destroys the only diagnostic available,
 * so unpack both shapes and always fall back to something concrete.
 */
export function describeFailure(payload: unknown, status: number): string {
  const raw =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error: unknown }).error
      : payload;

  if (typeof raw === 'string' && raw.trim()) return raw;

  if (raw && typeof raw === 'object') {
    const obj = raw as { code?: unknown; message?: unknown };
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    const message = typeof obj.message === 'string' ? obj.message : undefined;

    if (code && PLATFORM_HINTS[code]) {
      return `Image processing failed — ${PLATFORM_HINTS[code]} (${code})`;
    }
    if (message) return code ? `${message} (${code})` : message;
    if (code) return `Image processing failed (${code})`;
  }

  return `Image processing failed with HTTP ${status}.`;
}

export async function callPython<T>(
  endpoint: 'detect_bubbles' | 'evaluate_omr',
  body: unknown,
): Promise<T> {
  const url = `${await baseUrl()}/api/py/${endpoint}`;

  const headersInit: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PY_SHARED_SECRET) {
    headersInit['X-OMREval-Secret'] = process.env.PY_SHARED_SECRET;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headersInit,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new PyServiceError(
      'The image processing service is unreachable. Please try again in a moment.',
      503,
    );
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new PyServiceError('The image processing service returned an invalid response.');
  }

  if (!response.ok) {
    // 422 = a real, explainable problem with the uploaded image, raised by our
    // own handler. Anything else is a platform-level failure.
    throw new PyServiceError(
      describeFailure(payload, response.status),
      response.status === 422 ? 422 : 502,
    );
  }

  return payload as T;
}
