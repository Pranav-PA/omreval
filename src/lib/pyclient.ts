import { headers } from 'next/headers';

/**
 * Calls the Python (OpenCV) service.
 *
 * In production the functions live in the same deployment under /api/py/*, so
 * we call our own origin. For local `npm run dev` set PYTHON_API_URL to the
 * devserver.py address.
 *
 * Resolution order matters. `VERCEL_URL` is the *deployment-specific* hostname
 * (omreval-<hash>-<team>.vercel.app), and Vercel's Deployment Protection guards
 * exactly those generated URLs while leaving the production alias public. Using
 * it means this server-to-server hop gets bounced to Vercel SSO and comes back
 * 401 "Protected deployment", even though the site itself loads fine. So prefer
 * the host the request actually arrived on, which is by definition reachable.
 */
async function baseUrl(): Promise<string> {
  const explicit = process.env.PYTHON_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  }

  // The stable public alias, if the platform tells us what it is.
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionUrl) return `https://${productionUrl}`;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  throw new Error('Cannot resolve the image service URL.');
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
  endpoint: 'detect_bubbles' | 'evaluate_omr' | 'suggest_anchors',
  body: unknown,
): Promise<T> {
  const url = `${await baseUrl()}/api/py/${endpoint}`;

  const headersInit: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PY_SHARED_SECRET) {
    headersInit['X-OMREval-Secret'] = process.env.PY_SHARED_SECRET;
  }
  // Present only if "Protection Bypass for Automation" is enabled. Lets this
  // internal hop through even when Deployment Protection covers every URL.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headersInit['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    headersInit['x-vercel-set-bypass-cookie'] = 'false';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headersInit,
      body: JSON.stringify(body),
      cache: 'no-store',
      // Do not chase a redirect. Deployment Protection answers with a 307 to
      // Vercel's SSO page; following it turns a diagnosable 401 into an
      // unparseable HTML login form.
      redirect: 'manual',
    });
  } catch {
    throw new PyServiceError(
      'The image processing service is unreachable. Please try again in a moment.',
      503,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    const target = response.headers.get('location') ?? '';
    if (/vercel\.com\/sso-api|\/sso\b/.test(target)) {
      throw new PyServiceError(
        'The image processing service is behind Vercel Deployment Protection, so the ' +
          'app cannot reach its own function. Disable protection for this project, or ' +
          'enable Protection Bypass for Automation.',
        502,
      );
    }
    throw new PyServiceError(
      `The image processing service redirected unexpectedly (HTTP ${response.status}).`,
    );
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new PyServiceError(
      `The image processing service returned a non-JSON response (HTTP ${response.status}).`,
      response.status === 401 || response.status === 403 ? 502 : 502,
    );
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
