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
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'Image processing failed.';
    // 422 = a real, explainable problem with the uploaded image.
    throw new PyServiceError(message, response.status === 422 ? 422 : 502);
  }

  return payload as T;
}
