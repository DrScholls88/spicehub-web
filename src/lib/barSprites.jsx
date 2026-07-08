// barSprites.jsx — deterministic, offline, zero-asset pixel sprites for ANY
// bar ingredient. Extends the Saloon's PixelBottle idea into a reusable engine
// that also covers cans, citrus, herbs, garnishes, glassware, ice, egg, sugar.
//
// Public API:
//   spriteSpec(name) -> { kind, shape?, palette:{body,label,cap,accent}, glow }
//     Pure + total: any string returns a spec; unknown -> generic bottle.
//   <IngredientSprite name size glow /> -> pixel SVG for that spec.
//
// No network, no images, no LLM. Identical input -> identical output.

import { canonicalizeIngredient } from './barMatch';

// ── Palettes ──────────────────────────────────────────────────────────────────
const P = {
  gin:      { body: '#c8e6c9', label: '#388e3c', cap: '#555555', accent: '#a5d6a7' },
  vodka:    { body: '#c8d8e4', label: '#2196f3', cap: '#666666', accent: '#e3f2fd' },
  rum:      { body: '#8d6e63', label: '#ffcc02', cap: '#4e342e', accent: '#a1887f' },
  whiskey:  { body: '#a1887f', label: '#ff8f00', cap: '#5d4037', accent: '#d7ccc8' },
  tequila:  { body: '#fff9c4', label: '#f57f17', cap: '#827717', accent: '#fff59d' },
  wine:     { body: '#7b1fa2', label: '#e1bee7', cap: '#4a148c', accent: '#ce93d8' },
  beer:     { body: '#ffb74d', label: '#e65100', cap: '#bf360c', accent: '#ffe0b2' },
  liqueur:  { body: '#ff8a65', label: '#bf360c', cap: '#4e342e', accent: '#ffab91' },
  bitters:  { body: '#ffcc02', label: '#e65100', cap: '#5d4037', accent: '#ffe082' },
  vermouth: { body: '#a5d6a7', label: '#1b5e20', cap: '#2e7d32', accent: '#c8e6c9' },
  can:      { body: '#e0e0e0', label: '#424242', cap: '#9e9e9e', accent: '#f5f5f5' },
  syrup:    { body: '#d81b60', label: '#ffffff', cap: '#880e4f', accent: '#f06292' },
  brandy:   { body: '#a1887f', label: '#e65100', cap: '#5d4037', accent: '#d7ccc8' },
  lime:     { body: '#7cb342', label: '#33691e', cap: '#558b2f', accent: '#c5e1a5' },
  lemon:    { body: '#fdd835', label: '#f9a825', cap: '#f9a825', accent: '#fff59d' },
  orange:   { body: '#fb8c00', label: '#e65100', cap: '#ef6c00', accent: '#ffcc80' },
  mint:     { body: '#43a047', label: '#1b5e20', cap: '#2e7d32', accent: '#81c784' },
  cherry:   { body: '#e53935', label: '#b71c1c', cap: '#7f0000', accent: '#ef9a9a' },
  olive:    { body: '#9ccc65', label: '#558b2f', cap: '#33691e', accent: '#c5e1a5' },
  glass:    { body: '#cfd8dc', label: '#90a4ae', cap: '#b0bec5', accent: '#eceff1' },
  ice:      { body: '#b3e5fc', label: '#4fc3f7', cap: '#81d4fa', accent: '#e1f5fe' },
  egg:      { body: '#fff8e1', label: '#ffe0b2', cap: '#ffca28', accent: '#ffffff' },
  sugar:    { body: '#fafafa', label: '#e0e0e0', cap: '#bdbdbd', accent: '#ffffff' },
  generic:  { body: '#ce93d8', label: '#6a1b9a', cap: '#4a148c', accent: '#e1bee7' },
};

// ── Keyword table (ordered: specific first) ───────────────────────────────────
// Each entry: { kw:[...], kind, shape?, palette }. First match wins.
const TABLE = [
  // Juices/mixers that are cartons/cans — checked BEFORE citrus 'orange'/'lemon'
  { kw: ['orange juice', 'cranberry juice', 'pineapple juice', 'tomato juice', 'grapefruit juice', 'apple juice'], kind: 'can', palette: P.can },
  { kw: ['soda water', 'club soda', 'seltzer', 'sparkling water', 'tonic', 'tonic water', 'cola', 'coke', 'ginger beer', 'ginger ale', 'soda', 'lemonade', 'energy drink'], kind: 'can', palette: P.can },

  // Citrus (fruit + citrus juice)
  { kw: ['lime juice', 'lime wedge', 'lime'], kind: 'citrus', palette: P.lime },
  { kw: ['lemon juice', 'lemon wedge', 'lemon'], kind: 'citrus', palette: P.lemon },
  { kw: ['orange wedge', 'orange slice', 'orange peel', 'orange'], kind: 'citrus', palette: P.orange },
  { kw: ['grapefruit'], kind: 'citrus', palette: P.orange },

  // Herbs
  { kw: ['mint', 'basil', 'rosemary', 'thyme', 'sage', 'cilantro'], kind: 'herb', palette: P.mint },

  // Garnishes
  { kw: ['cherry', 'maraschino cherry', 'raspberry', 'strawberry'], kind: 'garnish', palette: P.cherry },
  { kw: ['olive', 'cocktail onion'], kind: 'garnish', palette: P.olive },

  // Glassware / tools
  { kw: ['coupe', 'martini glass', 'rocks glass', 'highball', 'tumbler', 'glass', 'glassware', 'shaker', 'jigger'], kind: 'glass', palette: P.glass },

  // Ice / egg / sugar / salt
  { kw: ['ice cube', 'ice cubes', 'crushed ice', 'ice'], kind: 'ice', palette: P.ice },
  { kw: ['egg white', 'egg yolk', 'egg', 'aquafaba'], kind: 'egg', palette: P.egg },
  { kw: ['simple syrup', 'sugar syrup', 'honey syrup', 'agave', 'honey', 'grenadine', 'orgeat'], kind: 'bottle', shape: 'round', palette: P.syrup },
  { kw: ['sugar', 'salt', 'superfine sugar', 'caster sugar', 'sea salt'], kind: 'sugar', palette: P.sugar },

  // Spirits & wine/beer (bottles)
  { kw: ['gin'], kind: 'bottle', shape: 'tall', palette: P.gin },
  { kw: ['vodka'], kind: 'bottle', shape: 'tall', palette: P.vodka },
  { kw: ['bourbon', 'whiskey', 'whisky', 'rye', 'scotch', 'tennessee whiskey'], kind: 'bottle', shape: 'square', palette: P.whiskey },
  { kw: ['tequila', 'mezcal'], kind: 'bottle', shape: 'tall', palette: P.tequila },
  { kw: ['rum', 'bacardi', 'cachaca'], kind: 'bottle', shape: 'round', palette: P.rum },
  { kw: ['cognac', 'brandy', 'armagnac', 'pisco', 'calvados'], kind: 'bottle', shape: 'round', palette: P.brandy },
  { kw: ['dry vermouth', 'sweet vermouth', 'vermouth'], kind: 'bottle', shape: 'tall', palette: P.vermouth },
  { kw: ['triple sec', 'cointreau', 'curacao', 'curaçao', 'grand marnier', 'orange liqueur', 'liqueur', 'kahlua', 'baileys', 'amaretto', 'aperol', 'campari', 'chartreuse'], kind: 'bottle', shape: 'round', palette: P.liqueur },
  { kw: ['angostura', 'bitters', "peychaud's", 'peychauds'], kind: 'bottle', shape: 'mini', palette: P.bitters },
  { kw: ['champagne', 'prosecco', 'sparkling wine', 'wine', 'sherry', 'port'], kind: 'bottle', shape: 'wine', palette: P.wine },
  { kw: ['beer', 'ale', 'lager', 'stout', 'ipa', 'cider'], kind: 'bottle', shape: 'beer', palette: P.beer },
];

const GENERIC = { kind: 'bottle', shape: 'round', palette: P.generic };

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(hay, hayWords, kw) {
  if (kw.includes(' ')) return hay.includes(kw);
  return hayWords.has(kw);
}

// Pure, total: any string -> a sprite spec.
export function spriteSpec(name) {
  const canon = normalize(canonicalizeIngredient(name));
  const raw = normalize(name);
  for (const source of [canon, raw]) {
    if (!source) continue;
    const words = new Set(source.split(' '));
    for (const entry of TABLE) {
      if (entry.kw.some(k => matches(source, words, k))) {
        return {
          kind: entry.kind,
          shape: entry.shape || null,
          palette: entry.palette,
          glow: false,
        };
      }
    }
  }
  return { ...GENERIC, glow: false };
}

// ── SVG renderers per kind ────────────────────────────────────────────────────
const px = { imageRendering: 'pixelated' };

function Bottle({ shape, c, s }) {
  const { body, label, cap } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'tall') return (
    <svg width={s * 0.6} height={s} viewBox="0 0 20 36" className={cls} style={px}>
      <rect x="7" y="0" width="6" height="3" fill={cap} />
      <rect x="8" y="3" width="4" height="6" fill={body} />
      <rect x="4" y="9" width="12" height="24" fill={body} rx="1" />
      <rect x="5" y="14" width="10" height="10" fill={label} />
      <rect x="5" y="10" width="2" height="16" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
  if (shape === 'square') return (
    <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={cls} style={px}>
      <rect x="8" y="0" width="6" height="3" fill={cap} />
      <rect x="9" y="3" width="4" height="5" fill={body} />
      <rect x="3" y="8" width="16" height="25" fill={body} rx="1" />
      <rect x="5" y="13" width="12" height="8" fill={label} />
      <rect x="4" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  if (shape === 'wine') return (
    <svg width={s * 0.5} height={s} viewBox="0 0 18 36" className={cls} style={px}>
      <rect x="7" y="0" width="4" height="3" fill={cap} />
      <rect x="7" y="3" width="4" height="10" fill={body} />
      <rect x="3" y="13" width="12" height="20" fill={body} rx="2" />
      <rect x="5" y="17" width="8" height="8" fill={label} rx="1" />
      <rect x="4" y="14" width="2" height="18" fill="rgba(255,255,255,0.15)" />
    </svg>
  );
  if (shape === 'beer') return (
    <svg width={s * 0.55} height={s * 0.85} viewBox="0 0 18 30" className={cls} style={px}>
      <rect x="6" y="0" width="6" height="3" fill={cap} />
      <rect x="7" y="3" width="4" height="4" fill={body} />
      <rect x="4" y="7" width="10" height="20" fill={body} rx="1" />
      <rect x="5" y="10" width="8" height="8" fill={label} />
      <rect x="5" y="8" width="2" height="18" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
  if (shape === 'mini') return (
    <svg width={s * 0.4} height={s * 0.7} viewBox="0 0 14 24" className={cls} style={px}>
      <rect x="5" y="0" width="4" height="2" fill={cap} />
      <rect x="5" y="2" width="4" height="4" fill={body} />
      <rect x="2" y="6" width="10" height="16" fill={body} rx="1" />
      <rect x="3" y="9" width="8" height="6" fill={label} />
      <rect x="3" y="7" width="2" height="14" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
  // round (default)
  return (
    <svg width={s * 0.65} height={s} viewBox="0 0 22 36" className={cls} style={px}>
      <rect x="8" y="0" width="6" height="3" fill={cap} />
      <rect x="9" y="3" width="4" height="5" fill={body} />
      <rect x="4" y="8" width="14" height="25" fill={body} rx="3" />
      <rect x="6" y="14" width="10" height="10" fill={label} rx="1" />
      <rect x="5" y="9" width="2" height="22" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
}

function Can({ c, s }) {
  const { body, label, cap } = c;
  return (
    <svg width={s * 0.5} height={s * 0.7} viewBox="0 0 16 22" className="bar-sprite-svg" style={px}>
      <rect x="2" y="0" width="12" height="22" fill={body} rx="2" />
      <rect x="3" y="1" width="10" height="3" fill={cap} rx="1" />
      <rect x="4" y="7" width="8" height="8" fill={label} />
      <rect x="3" y="2" width="2" height="18" fill="rgba(255,255,255,0.25)" />
    </svg>
  );
}

function Citrus({ c, s }) {
  const { body, accent, cap } = c;
  return (
    <svg width={s * 0.7} height={s * 0.7} viewBox="0 0 22 22" className="bar-sprite-svg" style={px}>
      <circle cx="11" cy="11" r="9" fill={body} />
      <circle cx="11" cy="11" r="6" fill={accent} />
      <rect x="10" y="4" width="2" height="14" fill={cap} opacity="0.5" />
      <rect x="4" y="10" width="14" height="2" fill={cap} opacity="0.5" />
      <rect x="6" y="6" width="10" height="2" fill={cap} opacity="0.3" transform="rotate(45 11 11)" />
      <rect x="6" y="14" width="10" height="2" fill={cap} opacity="0.3" transform="rotate(-45 11 11)" />
    </svg>
  );
}

function Herb({ c, s }) {
  const { body, accent, cap } = c;
  return (
    <svg width={s * 0.55} height={s * 0.75} viewBox="0 0 16 24" className="bar-sprite-svg" style={px}>
      <rect x="7" y="8" width="2" height="14" fill={cap} />
      <ellipse cx="5" cy="8" rx="4" ry="6" fill={body} />
      <ellipse cx="11" cy="10" rx="4" ry="6" fill={accent} />
      <ellipse cx="8" cy="4" rx="3" ry="5" fill={body} />
    </svg>
  );
}

function Garnish({ c, s }) {
  const { body, cap, accent } = c;
  return (
    <svg width={s * 0.5} height={s * 0.7} viewBox="0 0 14 22" className="bar-sprite-svg" style={px}>
      <rect x="6" y="0" width="1" height="14" fill={cap} />
      <circle cx="7" cy="16" r="5" fill={body} />
      <circle cx="5" cy="14" r="1.5" fill={accent} />
    </svg>
  );
}

function Glass({ c, s }) {
  const { body, accent } = c;
  return (
    <svg width={s * 0.6} height={s * 0.85} viewBox="0 0 20 28" className="bar-sprite-svg" style={px}>
      <path d="M3 3 L17 3 L11 14 L11 23 L15 25 L5 25 L9 23 L9 14 Z" fill={body} stroke={accent} strokeWidth="0.5" />
      <path d="M5 5 L15 5 L11 11 Z" fill={accent} opacity="0.5" />
    </svg>
  );
}

function Ice({ c, s }) {
  const { body, accent } = c;
  return (
    <svg width={s * 0.6} height={s * 0.55} viewBox="0 0 20 18" className="bar-sprite-svg" style={px}>
      <rect x="1" y="6" width="9" height="9" fill={body} rx="1" />
      <rect x="9" y="2" width="9" height="9" fill={accent} rx="1" />
      <rect x="2" y="7" width="2" height="2" fill="#ffffff" opacity="0.7" />
      <rect x="10" y="3" width="2" height="2" fill="#ffffff" opacity="0.7" />
    </svg>
  );
}

function Egg({ c, s }) {
  const { body, accent } = c;
  return (
    <svg width={s * 0.5} height={s * 0.65} viewBox="0 0 14 20" className="bar-sprite-svg" style={px}>
      <ellipse cx="7" cy="11" rx="6" ry="8" fill={body} />
      <ellipse cx="5" cy="8" rx="2" ry="3" fill={accent} opacity="0.8" />
    </svg>
  );
}

function Sugar({ c, s }) {
  const { body, cap } = c;
  return (
    <svg width={s * 0.6} height={s * 0.5} viewBox="0 0 20 16" className="bar-sprite-svg" style={px}>
      <rect x="2" y="8" width="7" height="7" fill={body} stroke={cap} strokeWidth="0.5" />
      <rect x="11" y="8" width="7" height="7" fill={body} stroke={cap} strokeWidth="0.5" />
      <rect x="6" y="1" width="7" height="7" fill={body} stroke={cap} strokeWidth="0.5" />
    </svg>
  );
}

// Public render component.
export function IngredientSprite({ name, size = 44, glow = false }) {
  const spec = spriteSpec(name);
  const c = spec.palette;
  const wrapCls = `bar-sprite ${glow ? 'bar-sprite--glow' : ''}`;
  let inner;
  switch (spec.kind) {
    case 'can':     inner = <Can c={c} s={size} />; break;
    case 'citrus':  inner = <Citrus c={c} s={size} />; break;
    case 'herb':    inner = <Herb c={c} s={size} />; break;
    case 'garnish': inner = <Garnish c={c} s={size} />; break;
    case 'glass':   inner = <Glass c={c} s={size} />; break;
    case 'ice':     inner = <Ice c={c} s={size} />; break;
    case 'egg':     inner = <Egg c={c} s={size} />; break;
    case 'sugar':   inner = <Sugar c={c} s={size} />; break;
    case 'bottle':
    default:        inner = <Bottle shape={spec.shape} c={c} s={size} />; break;
  }
  return <span className={wrapCls} title={name}>{inner}</span>;
}

export default { spriteSpec, IngredientSprite };
