'use client';

import { UPLOAD_MAX_DIM } from './constants';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface PreparedImage {
  /** JPEG blob, longest side capped at UPLOAD_MAX_DIM. */
  blob: Blob;
  /** Object URL for previewing. Revoke when done. */
  previewUrl: string;
  width: number;
  height: number;
}

/**
 * Downscales a photo in the browser before upload.
 *
 * This matters for two reasons: serverless request bodies are capped at a few
 * MB, and the Python side normalises to the same longest side anyway - so
 * shipping a 12 MP phone photo would just be wasted bandwidth.
 */
export async function prepareImage(
  file: File,
  maxDim = UPLOAD_MAX_DIM,
): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Please upload a JPG, PNG or WebP image.');
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file could not be read as an image.');
  });

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process this image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  if (!blob) throw new Error('Your browser could not process this image.');

  return { blob, previewUrl: URL.createObjectURL(blob), width, height };
}
