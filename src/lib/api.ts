import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { STORAGE_BUCKET } from './constants';
import { createClient } from './supabase/server';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Resolves the signed-in teacher. Call sites check `user` and bail with 401. */
export async function requireUser(): Promise<{
  user: { id: string; email?: string } | null;
  supabase: Supabase;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
}

/**
 * Duck-typed rather than `instanceof File` — `File` is not a global on Node 18,
 * and formData() hands back a Blob-alike either way.
 */
export function validateImage(value: unknown): { file: Blob } | { error: string } {
  if (!value || typeof value === 'string') {
    return { error: 'No image was uploaded.' };
  }
  const blob = value as Blob;
  if (typeof blob.arrayBuffer !== 'function' || typeof blob.size !== 'number') {
    return { error: 'No image was uploaded.' };
  }
  if (blob.size === 0) {
    return { error: 'No image was uploaded.' };
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    return { error: 'That image is too large. Please upload one under 8 MB.' };
  }
  if (!ACCEPTED.has(blob.type)) {
    return { error: 'Please upload a JPG, PNG or WebP image.' };
  }
  return { file: blob };
}

export async function toBase64(source: Blob): Promise<string> {
  return Buffer.from(await source.arrayBuffer()).toString('base64');
}

function extensionFor(type: string) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Uploads under `<user_id>/<kind>/...` — the storage RLS policy requires the
 * first path segment to be the uploader's id.
 */
export async function uploadImage(
  supabase: Supabase,
  userId: string,
  kind: 'templates' | 'students',
  file: Blob,
): Promise<{ path: string; url: string } | { error: string }> {
  const path = `${userId}/${kind}/${randomUUID()}.${extensionFor(file.type)}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    return { error: 'Could not save the image. Please try again.' };
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function downloadImage(
  supabase: Supabase,
  path: string,
): Promise<{ blob: Blob } | { error: string }> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) {
    return { error: 'The template image could not be loaded. Try re-creating the template.' };
  }
  return { blob: data };
}
