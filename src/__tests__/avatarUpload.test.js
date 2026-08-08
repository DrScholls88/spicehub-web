import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock compressBlob
vi.mock('../imageCompressor', () => ({
  compressBlob: vi.fn().mockResolvedValue('data:image/jpeg;base64,/9j/FAKE'),
}));

// Mock fetch for data-url-to-blob conversion
const mockFetchBlob = new Blob(['fake-jpeg'], { type: 'image/jpeg' });
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(mockFetchBlob) }));

// Mock supabaseClient
const mockUpload = vi.fn().mockResolvedValue({ error: null });
const mockGetPublicUrl = vi.fn().mockReturnValue({
  data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/uid/avatar.jpg' },
});
const mockRemove = vi.fn().mockResolvedValue({ error: null });

vi.mock('../lib/supabaseClient', () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
        remove: mockRemove,
      }),
    },
  }),
  getCurrentUserId: vi.fn().mockResolvedValue('test-uid-123'),
}));

vi.mock('../lib/cloudProfile', () => ({
  updateCloudProfile: vi.fn().mockResolvedValue(undefined),
}));

import { compressAvatarFile, uploadAvatarToStorage, updateAvatar } from '../lib/avatarUpload';
import { compressBlob } from '../imageCompressor';
import { updateCloudProfile } from '../lib/cloudProfile';

describe('avatarUpload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('compressAvatarFile calls compressBlob with correct params', async () => {
    const fakeFile = new Blob(['test'], { type: 'image/png' });
    const result = await compressAvatarFile(fakeFile);

    expect(compressBlob).toHaveBeenCalledWith(fakeFile, {
      maxWidth: 200,
      maxHeight: 200,
      quality: 0.8,
      format: 'image/jpeg',
    });
    expect(result.dataUrl).toBe('data:image/jpeg;base64,/9j/FAKE');
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('compressAvatarFile throws when compression returns null', async () => {
    compressBlob.mockResolvedValueOnce(null);
    const fakeFile = new Blob(['test'], { type: 'image/png' });
    await expect(compressAvatarFile(fakeFile)).rejects.toThrow('Image compression failed');
  });

  it('uploadAvatarToStorage uploads and returns public URL', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const url = await uploadAvatarToStorage(blob);

    expect(mockUpload).toHaveBeenCalledWith('test-uid-123/avatar.jpg', blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    expect(url).toContain('avatar.jpg');
  });

  it('uploadAvatarToStorage throws on upload error', async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: 'Quota exceeded' } });
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    await expect(uploadAvatarToStorage(blob)).rejects.toThrow('Upload failed: Quota exceeded');
  });

  it('updateAvatar orchestrates compress → upload → profile update', async () => {
    const fakeFile = new Blob(['img'], { type: 'image/png' });
    const result = await updateAvatar(fakeFile);

    expect(compressBlob).toHaveBeenCalledOnce();
    expect(mockUpload).toHaveBeenCalledOnce();
    expect(updateCloudProfile).toHaveBeenCalledWith({
      avatarUrl: expect.stringContaining('avatar.jpg'),
    });
    expect(result.dataUrl).toBeTruthy();
    expect(result.publicUrl).toBeTruthy();
  });
});
