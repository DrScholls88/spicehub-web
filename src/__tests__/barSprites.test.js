import { describe, it, expect } from 'vitest';
import { spriteSpec, IngredientSprite } from '../lib/barSprites.jsx';

// Note: this project's vitest config transforms JSX with esbuild's classic
// runtime (no @vitejs/plugin-react), so rendering a component in-test would need
// a React global the app build never requires. We therefore unit-test the pure
// spriteSpec logic (the part with real branching) and assert the component is a
// function; rendering is exercised manually / by the vite build.

describe('spriteSpec — bottles', () => {
  it('maps spirits to bottle shapes', () => {
    expect(spriteSpec('gin')).toMatchObject({ kind: 'bottle', shape: 'tall' });
    expect(spriteSpec('Bulleit bourbon')).toMatchObject({ kind: 'bottle', shape: 'square' });
    expect(spriteSpec('white rum')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('champagne')).toMatchObject({ kind: 'bottle', shape: 'wine' });
    expect(spriteSpec('angostura bitters')).toMatchObject({ kind: 'bottle', shape: 'mini' });
  });

  it('strips measures/quantities before matching', () => {
    expect(spriteSpec('2 oz gin')).toMatchObject({ kind: 'bottle', shape: 'tall' });
  });
});

describe('spriteSpec — non-bottle kinds', () => {
  it('citrus for fruit and citrus juice', () => {
    expect(spriteSpec('fresh lime juice').kind).toBe('citrus');
    expect(spriteSpec('lemon').kind).toBe('citrus');
    expect(spriteSpec('orange peel').kind).toBe('citrus');
  });

  it('cans for sodas and non-citrus juices', () => {
    expect(spriteSpec('club soda').kind).toBe('can');
    expect(spriteSpec('tonic water').kind).toBe('can');
    expect(spriteSpec('orange juice').kind).toBe('can'); // carton, not citrus
    expect(spriteSpec('cranberry juice').kind).toBe('can');
  });

  it('herbs, garnishes, glass, ice, egg, sugar', () => {
    expect(spriteSpec('fresh mint').kind).toBe('herb');
    expect(spriteSpec('maraschino cherry').kind).toBe('garnish');
    expect(spriteSpec('olive').kind).toBe('garnish');
    expect(spriteSpec('coupe glass').kind).toBe('glass');
    expect(spriteSpec('crushed ice').kind).toBe('ice');
    expect(spriteSpec('egg white').kind).toBe('egg');
    expect(spriteSpec('sugar').kind).toBe('sugar');
  });

  it('does not false-match ice inside juice', () => {
    // "juice" contains the substring "ice" — must not resolve to ice kind
    expect(spriteSpec('orange juice').kind).not.toBe('ice');
  });
});

describe('spriteSpec — totality & determinism', () => {
  it('unknown ingredients fall back to a generic bottle', () => {
    expect(spriteSpec('unicorn dust')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('')).toMatchObject({ kind: 'bottle' });
    expect(spriteSpec(null)).toMatchObject({ kind: 'bottle' });
    expect(spriteSpec(undefined)).toMatchObject({ kind: 'bottle' });
  });

  it('is deterministic and carries a full palette', () => {
    const a = spriteSpec('gin');
    const b = spriteSpec('gin');
    expect(a).toEqual(b);
    expect(a.palette).toEqual(
      expect.objectContaining({ body: expect.any(String), label: expect.any(String), cap: expect.any(String), accent: expect.any(String) })
    );
  });
});

describe('IngredientSprite', () => {
  it('is exported as a component function', () => {
    expect(typeof IngredientSprite).toBe('function');
  });

  it('spriteSpec resolves a kind the renderer has a branch for', () => {
    const kinds = new Set(['bottle', 'can', 'citrus', 'herb', 'garnish', 'glass', 'ice', 'egg', 'sugar']);
    for (const name of ['gin', 'club soda', 'lime', 'mint', 'olive', 'coupe glass', 'ice', 'egg white', 'sugar', 'unicorn dust']) {
      expect(kinds.has(spriteSpec(name).kind)).toBe(true);
    }
  });
});
