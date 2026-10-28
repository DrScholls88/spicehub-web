// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN CORPUS — text-encoding integrity of the heuristic parser
// ─────────────────────────────────────────────────────────────────────────────
// Several regex character classes in recipeParser.js / socialCaption.js were
// saved through a Windows-1252 round-trip TWICE ("•" became "Ã¢â‚¬Â¢"), so bullets,
// ⅓/⅔ fractions, "sauté", dashes and emoji silently stopped matching. The
// classes are now written as \u escapes. These cases pin the behaviour, and the
// guard at the bottom fails the build if mojibake ever reappears in source.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { classifyWithConfidence, parseCaption } from '../../src/recipeParser.js';
import { cleanSocialCaption, isCaptionWeak } from '../../src/import/clean/socialCaption.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('heuristic parser — unicode classes', () => {
  it('reads ⅓ and ⅔ as quantities', () => {
    const [a, b] = classifyWithConfidence(['⅓ cup olive oil', '⅔ tsp smoked paprika']);
    expect(a.reason).toBe('has quantity + unit');
    expect(b.reason).toBe('has quantity + unit');
  });

  it('reads "Sauté …" as a direction', () => {
    const [r] = classifyWithConfidence(['Sauté the onions until soft and golden']);
    expect(r.category).toBe('direction');
  });

  it('strips • and ▪ bullets from ingredient lines and keeps ½', () => {
    const out = parseCaption(
      'Ingredients:\n• 2 cups flour\n• ½ cup milk\n▪ 1 tsp salt\n\n'
      + 'Instructions:\n1. Whisk the flour, milk and salt together.\n2. Bake for 20 minutes until golden.'
    );
    const ings = out.ingredients.map((i) => (typeof i === 'string' ? i : i.text || i.raw || ''));
    expect(ings.some((i) => /2 cups flour/.test(i))).toBe(true);
    expect(ings.some((i) => /½ cup milk/.test(i))).toBe(true);
    expect(ings.some((i) => /^[•▪]/.test(i))).toBe(false);
  });

  it('never leaves half an emoji behind', () => {
    const out = parseCaption('🔸 2 cups rice\n🥕 1 carrot, diced\n🧄 3 cloves garlic\n\nCook the rice and carrot for 15 minutes.');
    for (const line of [...out.ingredients, ...out.directions]) {
      const s = typeof line === 'string' ? line : JSON.stringify(line);
      expect(LONE_SURROGATE.test(s)).toBe(false);
    }
  });
});

describe('cleanSocialCaption — unicode classes', () => {
  it('drops pointer-emoji bait lines but keeps emoji-led ingredients', () => {
    const t = cleanSocialCaption('Garlic chicken\n👇 Full recipe below\n🍗 2 chicken breasts\n🧄 3 cloves garlic');
    expect(t).not.toMatch(/Full recipe below/);
    expect(t).toMatch(/2 chicken breasts/);
    expect(t).toMatch(/3 cloves garlic/);
    expect(LONE_SURROGATE.test(t)).toBe(false);
  });

  it('strips an en-dash engagement header', () => {
    const t = cleanSocialCaption('1,234 likes, 56 comments – chefjohn on May 1, 2026: Best pasta\n2 cups flour');
    expect(t).not.toMatch(/likes/);
    expect(t).toMatch(/2 cups flour/);
  });

  it('strips a "… more" truncation tail', () => {
    expect(cleanSocialCaption('2 cups flour\n1 egg … more')).not.toMatch(/more\s*$/);
  });

  it('treats 180°C as a recipe signal', () => {
    expect(isCaptionWeak('Bake at 180°C until golden')).toBe(false);
  });
});

describe('source guard — no mojibake', () => {
  // Double- or single-encoded UTF-8 read back as cp1252: "Ã‚Â°", "Ã¢â‚¬", "â€", "ðŸ".
  // Built from escapes so this file can never trip its own check.
  const MOJIBAKE = new RegExp('Ã[\u0080-¿Œ-™]|Â[ -¿]|â€|ðŸ');
  const ROOTS = ['src', 'api'];
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|mjs|css)$/.test(name)) files.push(p);
    }
  };
  ROOTS.forEach(walk);

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no source file contains cp1252 mojibake', () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8').split('\n')
        .map((l, i) => (MOJIBAKE.test(l) ? `${f}:${i + 1}` : null))
        .filter(Boolean));
    expect(hits).toEqual([]);
  }, 30_000); // walking the mounted tree is slow on CI/VMs
});
