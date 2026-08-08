/**
 * Avatar upload pipeline — compress → upload to Supabase Storage → update profile.
 *
 * Uses the existing canvas compressor from imageCompressor.js (no new deps).
 * Target: 200x200 JPEG @ 0.8 quality → ~30-80KB per avatar.
 *
 * iOS notes:
 * - Safari doesn't support WebP canvas output — JPEG fallback is automatic
 *   via compressFromImageSrc's existing length guard. We pass 'image/jpeg'
 *   directly anyway, so no fallback branch is even needed here.
 * - iOS photo picker preserves EXIF; modern WebKit auto-corrects orientation
 *   when drawing to canvas (Safari 13.1+), so no manual EXIF rotation needed.
 */
import { compressBlob } from '../imageCompressor';
import { getSupabase, getCurrentUserId } from './supabaseClient';
import { updateCloudProfile } from './cloudProfile';

const AVATAR_MAX_SIZE = 200;
const AVATAR_QUALITY = 0.8;
const AVATAR_FORMAT = 'image/jpeg'; // JPEG, not WebP — Safari compat

/**
 * Compress a File (from <input type="file">) to a small JPEG blob.
 * @param {File} file
 * @returns {Promise<{ dataUrl: string, blob: Blob }>}
 */
export async function compressAvatarFile(file) {
  const dataUrl = await compressBlob(file, {
    maxWidth: AVATAR_MAX_SIZE,
    maxHeight: AVATAR_MAX_SIZE,
    quality: AVATAR_QUALITY,
    format: AVATAR_FORMAT,
  });
  if (!dataUrl) throw new Error('Image compression failed');

  // Convert data URL back to Blob for Storage upload
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return { dataUrl, blob };
}

/**
 * Upload a compressed avatar blob to Supabase Storage.
 * Path convention: avatars/{userId}/avatar.jpg
 * Returns the public URL on success.
 * @param {Blob} blob
 * @returns {Promise<string>} public URL
 */
export async function uploadAvatarToStorage(blob) {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Not signed in');

  const filePath = `${userId}/avatar.jpg`;

  // Upsert: if the file already exists, overwrite it.
  const { error } = await supabase.storage
    .from('avatars')
    .upload(filePath, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  // Get the public URL (bucket is public, so this never expires)
  const { data: urlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

/**
 * Full avatar update flow:
 * 1. Compress the file
 * 2. Upload to Storage
 * 3. Update profiles.avatar_url
 * Returns { dataUrl, publicUrl } for optimistic UI.
 * @param {File} file
 */
export async function updateAvatar(file) {
  const { dataUrl, blob } = await compressAvatarFile(file);
  const publicUrl = await uploadAvatarToStorage(blob);

  // Persist the public URL to the profile (+ propagate to home_group_members)
  await updateCloudProfile({ avatarUrl: publicUrl });

  return { dataUrl, publicUrl };
}

/**
 * Remove custom avatar — clears avatar_url from profile, falling back to
 * the pixel emoji avatar.
 */
export async function removeCustomAvatar() {
  const supabase = getSupabase();
  const userId = await getCurrentUserId();
  if (!userId) return;

  // Delete the file from Storage (best-effort)
  try {
    await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]);
  } catch { /* file may not exist */ }

  // Clear the URL from the profile
  await updateCloudProfile({ avatarUrl: null });
}
