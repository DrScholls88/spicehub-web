import { describe, it, expect } from 'vitest';
import {
  buildMediaModel,
  mediaPatchForDelete,
  mediaPatchForUpload,
} from '../lib/recipeMedia.js';

// The recipe hero carousel (RecipeMediaCarousel) is shared by the full recipe
// card and the library quick-peek. Everything with real branching in it lives
// here: which photos exist and in what order, and what a delete or an upload
// should actually persist. These tests pin the two behaviours that are easy to
// regress without noticing in the UI — the cover hand-off on delete, and the
// fact that removing an import-sourced photo must NOT splice the extraction
// arrays (db.js's mergeRecipeData unions those back on every re-import).

const VIDEO = { id: 'abc123', label: 'YouTube', embedUrl: 'https://x/embed/abc123' };

describe('buildMediaModel', () => {
  it('returns an empty model for a recipe with no media at all', () => {
    const m = buildMediaModel({ name: 'Toast' }, null);
    expect(m.photos).toEqual([]);
    expect(m.slides).toEqual([]);
    expect(m.videoIndex).toBe(-1);
  });

  it('survives null/garbage input without throwing', () => {
    expect(buildMediaModel(null, null).slides).toEqual([]);
    expect(buildMediaModel({ userPhotos: 'nope', _scanPages: 7 }, null).photos).toEqual([]);
  });

  it('puts the cover photo first, then the user\'s own additions', () => {
    const m = buildMediaModel(
      { name: 'Chili', imageUrl: 'cover.jpg', userPhotos: ['mine-1.webp', 'mine-2.webp'] },
      null,
    );
    expect(m.photos.map(p => p.src)).toEqual(['cover.jpg', 'mine-1.webp', 'mine-2.webp']);
    expect(m.photos.map(p => p.origin)).toEqual(['primary', 'user', 'user']);
  });

  it('orders every source: cover, user, scan pages, carousel, instagram', () => {
    const m = buildMediaModel({
      name: 'Ragu',
      imageUrl: 'cover.jpg',
      userPhotos: ['mine.webp'],
      _scanPages: ['page1.png'],
      _carouselImages: [{ url: 'https://ig/1.jpg', dataUrl: 'cached1.jpg' }],
      _igCarouselImages: ['https://ig/2.jpg'],
    }, null);
    expect(m.photos.map(p => p.src)).toEqual([
      'cover.jpg', 'mine.webp', 'page1.png', 'cached1.jpg', 'https://ig/2.jpg',
    ]);
  });

  it('prefers a carousel entry\'s cached dataUrl and does not re-add its raw url', () => {
    const m = buildMediaModel({
      name: 'Ragu',
      _carouselImages: [{ url: 'https://ig/1.jpg', dataUrl: 'cached1.jpg' }],
      _igCarouselImages: ['https://ig/1.jpg', 'https://ig/2.jpg'],
    }, null);
    expect(m.photos.map(p => p.src)).toEqual(['cached1.jpg', 'https://ig/2.jpg']);
  });

  it('dedupes a src that appears as both the cover and a carousel frame', () => {
    const m = buildMediaModel({
      name: 'Ragu',
      imageUrl: 'shot.jpg',
      _igCarouselImages: ['shot.jpg', 'other.jpg'],
    }, null);
    expect(m.photos.map(p => p.src)).toEqual(['shot.jpg', 'other.jpg']);
  });

  it('applies the hiddenPhotos suppression list', () => {
    const m = buildMediaModel({
      name: 'Ragu',
      imageUrl: 'cover.jpg',
      _igCarouselImages: ['a.jpg', 'b.jpg'],
      hiddenPhotos: ['a.jpg'],
    }, null);
    expect(m.photos.map(p => p.src)).toEqual(['cover.jpg', 'b.jpg']);
  });

  it('makes the video slide first and shifts photoIndex accordingly', () => {
    const m = buildMediaModel({ name: 'Ragu', imageUrl: 'cover.jpg' }, VIDEO);
    expect(m.videoIndex).toBe(0);
    expect(m.slides[0].type).toBe('video');
    expect(m.slides[1]).toMatchObject({ type: 'photo', photoIndex: 0, src: 'cover.jpg' });
  });

  it('has no video slide when there is no video source', () => {
    const m = buildMediaModel({ name: 'Ragu', imageUrl: 'cover.jpg' }, null);
    expect(m.videoIndex).toBe(-1);
    expect(m.slides[0]).toMatchObject({ type: 'photo', photoIndex: 0 });
  });

  it('gives every slide a distinct key even for near-identical long urls', () => {
    const long = 'https://scontent.example.com/' + 'x'.repeat(200);
    const m = buildMediaModel({ name: 'Ragu', _igCarouselImages: [long + 'A', long + 'B'] }, null);
    const keys = m.slides.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('mediaPatchForDelete', () => {
  it('removes a user photo from userPhotos outright', () => {
    const item = { imageUrl: 'cover.jpg', userPhotos: ['mine-1.webp', 'mine-2.webp'] };
    const { photos } = buildMediaModel(item, null);
    const target = photos.find(p => p.src === 'mine-1.webp');
    const patch = mediaPatchForDelete(item, target, photos);
    expect(patch.userPhotos).toEqual(['mine-2.webp']);
    expect(patch).not.toHaveProperty('hiddenPhotos');
    expect(patch).not.toHaveProperty('imageUrl');
  });

  it('suppresses an import-sourced photo instead of touching the import arrays', () => {
    const item = { imageUrl: 'cover.jpg', _igCarouselImages: ['a.jpg', 'b.jpg'] };
    const { photos } = buildMediaModel(item, null);
    const target = photos.find(p => p.src === 'a.jpg');
    const patch = mediaPatchForDelete(item, target, photos);
    expect(patch.hiddenPhotos).toEqual(['a.jpg']);
    expect(patch).not.toHaveProperty('_igCarouselImages');
  });

  it('does not duplicate an entry already on the suppression list', () => {
    const item = { _igCarouselImages: ['a.jpg'], hiddenPhotos: ['a.jpg'] };
    const patch = mediaPatchForDelete(item, { src: 'a.jpg', origin: 'ig' }, []);
    expect(patch.hiddenPhotos).toEqual(['a.jpg']);
  });

  it('promotes the next surviving photo when the cover is deleted', () => {
    const item = { imageUrl: 'cover.jpg', _igCarouselImages: ['b.jpg'] };
    const { photos } = buildMediaModel(item, null);
    const target = photos.find(p => p.src === 'cover.jpg');
    const patch = mediaPatchForDelete(item, target, photos);
    expect(patch.imageUrl).toBe('b.jpg');
    expect(patch.hiddenPhotos).toEqual(['cover.jpg']);
  });

  it('clears the cover when the deleted photo was the only one', () => {
    const item = { imageUrl: 'cover.jpg' };
    const { photos } = buildMediaModel(item, null);
    const patch = mediaPatchForDelete(item, photos[0], photos);
    expect(patch.imageUrl).toBe('');
  });

  it('does not leave a promoted user photo listed twice', () => {
    const item = { imageUrl: 'cover.jpg', userPhotos: ['mine.webp'] };
    const { photos } = buildMediaModel(item, null);
    const target = photos.find(p => p.src === 'cover.jpg');
    const patch = mediaPatchForDelete(item, target, photos);
    expect(patch.imageUrl).toBe('mine.webp');
    expect(patch.userPhotos).toEqual([]);
  });

  it('returns null for a missing item or photo', () => {
    expect(mediaPatchForDelete(null, { src: 'a' }, [])).toBeNull();
    expect(mediaPatchForDelete({}, null, [])).toBeNull();
  });
});

describe('mediaPatchForUpload', () => {
  it('appends new photos to userPhotos', () => {
    const item = { imageUrl: 'cover.jpg', userPhotos: ['old.webp'] };
    const { photos } = buildMediaModel(item, null);
    const res = mediaPatchForUpload(item, ['new.webp'], photos);
    expect(res.fresh).toEqual(['new.webp']);
    expect(res.patch.userPhotos).toEqual(['old.webp', 'new.webp']);
    expect(res.patch).not.toHaveProperty('imageUrl');
  });

  it('adopts the first upload as the cover when the recipe has none', () => {
    const item = {};
    const res = mediaPatchForUpload(item, ['new-1.webp', 'new-2.webp'], []);
    expect(res.patch.imageUrl).toBe('new-1.webp');
    expect(res.patch.userPhotos).toEqual(['new-2.webp']);
  });

  it('skips a photo the recipe already has', () => {
    const item = { imageUrl: 'cover.jpg' };
    const { photos } = buildMediaModel(item, null);
    expect(mediaPatchForUpload(item, ['cover.jpg'], photos)).toBeNull();
  });

  it('un-hides a suppressed photo the user deliberately re-adds', () => {
    const item = { imageUrl: 'cover.jpg', hiddenPhotos: ['gone.webp', 'other.webp'] };
    const { photos } = buildMediaModel(item, null);
    const res = mediaPatchForUpload(item, ['gone.webp'], photos);
    expect(res.patch.hiddenPhotos).toEqual(['other.webp']);
    expect(res.patch.userPhotos).toEqual(['gone.webp']);
  });

  it('returns null when nothing was decoded', () => {
    expect(mediaPatchForUpload({}, [], [])).toBeNull();
    expect(mediaPatchForUpload(null, ['a.webp'], [])).toBeNull();
  });
});
