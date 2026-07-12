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
  it('unknown ingredients fall back to a (varied) bottle', () => {
    const u = spriteSpec('unicorn dust');
    expect(u.kind).toBe('bottle');
    expect(['round', 'tall', 'square', 'mini']).toContain(u.shape);
    expect(spriteSpec('')).toMatchObject({ kind: 'bottle' });
    expect(spriteSpec(null)).toMatchObject({ kind: 'bottle' });
    expect(spriteSpec(undefined)).toMatchObject({ kind: 'bottle' });
  });

  it('gives different unknown ingredients different sprites (variety)', () => {
    const a = spriteSpec('zzz mystery one');
    const b = spriteSpec('qqq mystery two');
    // Not guaranteed different, but the hash should spread most pairs apart.
    expect(a.palette.body === b.palette.body && a.shape === b.shape).toBe(false);
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

describe('spriteSpec — kitchen/pantry kinds', () => {
  it('covers the Pantry quick-add list with non-bottle kinds', () => {
    expect(spriteSpec('chicken breast')).toMatchObject({ kind: 'protein', shape: 'poultry' });
    expect(spriteSpec('ground beef')).toMatchObject({ kind: 'protein', shape: 'steak' });
    expect(spriteSpec('eggs').kind).toBe('egg');
    expect(spriteSpec('milk')).toMatchObject({ kind: 'dairy', shape: 'carton' });
    expect(spriteSpec('cheddar cheese')).toMatchObject({ kind: 'dairy', shape: 'wedge' });
    expect(spriteSpec('spinach')).toMatchObject({ kind: 'produce', shape: 'leafy' });
    expect(spriteSpec('tomatoes')).toMatchObject({ kind: 'produce', shape: 'round' });
    expect(spriteSpec('bell peppers')).toMatchObject({ kind: 'produce', shape: 'pepper' });
    expect(spriteSpec('mushrooms')).toMatchObject({ kind: 'produce', shape: 'cap' });
    expect(spriteSpec('potatoes')).toMatchObject({ kind: 'produce', shape: 'round' });
    expect(spriteSpec('lemons').kind).toBe('citrus');
    expect(spriteSpec('cilantro').kind).toBe('herb');
  });

  it('covers the Pantry staples with non-bottle kinds (except real bottles: oils/vanilla)', () => {
    expect(spriteSpec('salt').kind).toBe('shaker');
    expect(spriteSpec('black pepper').kind).toBe('shaker');
    expect(spriteSpec('olive oil')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('vegetable oil')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('flour')).toMatchObject({ kind: 'drygood', shape: 'sack' });
    expect(spriteSpec('sugar').kind).toBe('sugar');
    expect(spriteSpec('butter')).toMatchObject({ kind: 'dairy', shape: 'stick' });
    expect(spriteSpec('garlic')).toMatchObject({ kind: 'produce', shape: 'bulb' });
    expect(spriteSpec('onions')).toMatchObject({ kind: 'produce', shape: 'bulb' });
    expect(spriteSpec('rice')).toMatchObject({ kind: 'drygood', shape: 'sack' });
    expect(spriteSpec('pasta')).toMatchObject({ kind: 'drygood', shape: 'box' });
    expect(spriteSpec('soy sauce').kind).toBe('can');
    expect(spriteSpec('ketchup')).toMatchObject({ kind: 'jar', shape: 'condiment' });
    expect(spriteSpec('mustard')).toMatchObject({ kind: 'jar', shape: 'condiment' });
    expect(spriteSpec('mayonnaise')).toMatchObject({ kind: 'jar', shape: 'condiment' });
    expect(spriteSpec('baking soda')).toMatchObject({ kind: 'drygood', shape: 'box' });
    expect(spriteSpec('baking powder')).toMatchObject({ kind: 'drygood', shape: 'box' });
    expect(spriteSpec('vanilla extract')).toMatchObject({ kind: 'bottle', shape: 'mini' });
    expect(spriteSpec('honey')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('vinegar')).toMatchObject({ kind: 'bottle', shape: 'round' });
    expect(spriteSpec('chicken broth').kind).toBe('can');
    expect(spriteSpec('hot sauce')).toMatchObject({ kind: 'jar', shape: 'condiment' });
    expect(spriteSpec('brown sugar').kind).toBe('sugar');
  });

  it('does not let a compound word get shadowed by a later single-word match', () => {
    // "chicken broth" must stay a can/broth, not fall through to poultry protein
    expect(spriteSpec('chicken broth').kind).not.toBe('protein');
    // "black pepper" must stay a shaker, not fall through to produce pepper
    expect(spriteSpec('black pepper').kind).not.toBe('produce');
    // "tomato sauce" must stay a condiment jar, not fall through to produce tomato
    expect(spriteSpec('tomato sauce')).toMatchObject({ kind: 'jar', shape: 'condiment' });
  });

  it('spice jars get varied (but deterministic) palettes', () => {
    const a1 = spriteSpec('paprika');
    const a2 = spriteSpec('paprika');
    expect(a1).toEqual(a2);
    expect(a1.kind).toBe('jar');
    expect(a1.shape).toBe('spice');
    expect(a1.palette).toEqual(
      expect.objectContaining({ body: expect.any(String), label: expect.any(String), cap: expect.any(String), accent: expect.any(String) })
    );
  });

  it('bar behavior is unchanged by the kitchen additions', () => {
    expect(spriteSpec('gin')).toMatchObject({ kind: 'bottle', shape: 'tall' });
    expect(spriteSpec('tonic water').kind).toBe('can');
    expect(spriteSpec('olive').kind).toBe('garnish'); // still a cocktail garnish, not oil
  });
});
