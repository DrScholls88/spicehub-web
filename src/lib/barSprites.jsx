// barSprites.jsx — deterministic, offline, zero-asset pixel sprites for ANY
// bar OR kitchen ingredient. Extends the Saloon's PixelBottle idea into a
// reusable engine that covers cans, citrus, herbs, garnishes, glassware, ice,
// egg, sugar (bar) AND produce, protein, dairy, dry goods, spice jars, and
// shakers (kitchen/Pantry).
//
// Public API:
//   spriteSpec(name) -> { kind, shape?, palette:{body,label,cap,accent}, glow }
//     Pure + total: any string returns a spec; unknown -> generic bottle.
//   <IngredientSprite name size glow /> -> pixel SVG for that spec.
//
// No network, no images, no LLM, no sprite-sheet asset pipeline. Identical
// input -> identical output — this keeps the offline-first / zero-cost
// constitution intact (no build-time image assets to source or ship).

import { canonicalizeIngredient } from './barMatch';

// ── Palettes ──────────────────────────────────────────────────────────────────
const P = {
  gin:      { body: '#c8e6c9', label: '#388e3c', cap: '#555555', accent: '#a5d6a7' },
  vodka:    { body: '#c8d8e4', label: '#2196f3', cap: '#666666', accent: '#e3f2fd' },
  amaro:    { body: '#c0392b', label: '#7b241c', cap: '#5b1a12', accent: '#e6796b' },
  cream:    { body: '#e8dcc0', label: '#a1887f', cap: '#8d6e63', accent: '#fff8e1' },
  coffee:   { body: '#4e342e', label: '#ffcc02', cap: '#3e2723', accent: '#795548' },
  berry:    { body: '#8e44ad', label: '#e1bee7', cap: '#5b2c6f', accent: '#ce93d8' },
  herbal:   { body: '#4e9a51', label: '#1b5e20', cap: '#2e7d32', accent: '#a5d6a7' },
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

  // ── Kitchen — oils & vinegars ────────────────────────────────────────────
  oil:      { body: '#c9a227', label: '#556b2f', cap: '#3e5c2a', accent: '#e8d27a' },

  // ── Kitchen — condiments/sauces/broths ───────────────────────────────────
  condRed:    { body: '#e53935', label: '#ffffff', cap: '#7f0000', accent: '#ef9a9a' },
  condYellow: { body: '#ffd54f', label: '#f9a825', cap: '#e65100', accent: '#fff59d' },
  condWhite:  { body: '#fafaf5', label: '#e0ddd0', cap: '#bdbdbd', accent: '#ffffff' },
  condBrown:  { body: '#5d4037', label: '#3e2723', cap: '#4e342e', accent: '#8d6e63' },

  // ── Kitchen — spice jars (varied by hash) & shakers ──────────────────────
  spiceRed:     { body: '#c0392b', label: '#e6796b', cap: '#5b1a12', accent: '#e6796b' },
  spiceGreen:   { body: '#556b2f', label: '#a5d67a', cap: '#33691e', accent: '#c5e1a5' },
  spiceGold:    { body: '#c98a1f', label: '#f5c26b', cap: '#8a5a10', accent: '#f5c26b' },
  spiceBrown:   { body: '#6d4c2f', label: '#a1887f', cap: '#4e342e', accent: '#a1887f' },
  saltShaker:   { body: '#f5f5f5', label: '#bdbdbd', cap: '#9e9e9e', accent: '#ffffff' },
  pepperShaker: { body: '#3e3e3e', label: '#666666', cap: '#1c1c1c', accent: '#5a5a5a' },

  // ── Kitchen — dairy ───────────────────────────────────────────────────────
  milk:    { body: '#f5f5f0', label: '#4fc3f7', cap: '#90caf9', accent: '#ffffff' },
  cheese:  { body: '#ffca28', label: '#f9a825', cap: '#e65100', accent: '#fff59d' },
  yogurt:  { body: '#fdfdfb', label: '#ce93d8', cap: '#ba68c8', accent: '#ffffff' },
  butterK: { body: '#ffe082', label: '#ffca28', cap: '#f9a825', accent: '#fff3c4' },

  // ── Kitchen — protein ─────────────────────────────────────────────────────
  steak:   { body: '#c0392b', label: '#e6a89a', cap: '#7f0000', accent: '#f5b7ad' },
  poultry: { body: '#f0c8a0', label: '#e8a878', cap: '#d18a5c', accent: '#fbe3cc' },
  porkK:   { body: '#e8a1a1', label: '#f5c6c6', cap: '#c97a7a', accent: '#f9dede' },
  fishK:   { body: '#b0bec5', label: '#e8a1a1', cap: '#78909c', accent: '#eceff1' },
  shrimpK: { body: '#f5a89a', label: '#ffccbc', cap: '#e6796b', accent: '#ffe0d6' },
  tofuK:   { body: '#fdfdf5', label: '#e0e0d0', cap: '#c9c9b8', accent: '#ffffff' },

  // ── Kitchen — grains / dry goods / baking ────────────────────────────────
  flour:     { body: '#f5f0e1', label: '#d7c9a3', cap: '#a1887f', accent: '#ffffff' },
  riceK:     { body: '#f5f0e1', label: '#e0d5b8', cap: '#bcaa8e', accent: '#ffffff' },
  pastaK:    { body: '#f6d365', label: '#e6a817', cap: '#a86b0c', accent: '#fbe8a6' },
  breadK:    { body: '#c98a4b', label: '#a1662f', cap: '#7a4a22', accent: '#e8b98a' },
  tortillaK: { body: '#f0dfae', label: '#d9c48a', cap: '#b8a06a', accent: '#faf1d8' },
  cocoaK:    { body: '#4e342e', label: '#3e2723', cap: '#2b1a15', accent: '#795548' },
  bakingBox: { body: '#e53935', label: '#ffffff', cap: '#b71c1c', accent: '#ffcdd2' },
  vanillaK:  { body: '#6d4c2f', label: '#c9a86b', cap: '#4e342e', accent: '#e8d3a0' },

  // ── Kitchen — produce ─────────────────────────────────────────────────────
  onionK:       { body: '#d8b4d8', label: '#f5e6f5', cap: '#8e5c8e', accent: '#f0d9f0' },
  potatoK:      { body: '#c9a876', label: '#a8824f', cap: '#8a6a3f', accent: '#e0c398' },
  carrotK:      { body: '#f57c00', label: '#4caf50', cap: '#2e7d32', accent: '#ffb74d' },
  broccoliK:    { body: '#2e7d32', label: '#1b5e20', cap: '#6d4c2f', accent: '#66bb6a' },
  cauliK:       { body: '#f5f0e6', label: '#e0d9c8', cap: '#a5d67a', accent: '#ffffff' },
  leafyK:       { body: '#2e7d32', label: '#43a047', cap: '#1b5e20', accent: '#81c784' },
  tomatoK:      { body: '#e53935', label: '#c62828', cap: '#2e7d32', accent: '#ef9a9a' },
  pepperGreenK: { body: '#43a047', label: '#2e7d32', cap: '#1b5e20', accent: '#a5d67a' },
  pepperRedK:   { body: '#e53935', label: '#c62828', cap: '#1b5e20', accent: '#ef9a9a' },
  cornK:        { body: '#fdd835', label: '#f9a825', cap: '#558b2f', accent: '#fff59d' },
  mushroomK:    { body: '#c9a876', label: '#a1887f', cap: '#8d6e63', accent: '#e0c398' },
  avocadoK:     { body: '#33691e', label: '#7cb342', cap: '#1b5e20', accent: '#aed581' },
  cucumberK:    { body: '#558b2f', label: '#33691e', cap: '#2e7d32', accent: '#8bc34a' },
  squashK:      { body: '#fb8c00', label: '#ef6c00', cap: '#2e7d32', accent: '#ffb74d' },
  peaK:         { body: '#7cb342', label: '#558b2f', cap: '#33691e', accent: '#aed581' },
  bananaK:      { body: '#fdd835', label: '#f9a825', cap: '#827717', accent: '#fff59d' },
  appleK:       { body: '#e53935', label: '#c62828', cap: '#2e7d32', accent: '#ef9a9a' },
  brusselsK:    { body: '#33691e', label: '#558b2f', cap: '#1b5e20', accent: '#7cb342' },
  edamameK:     { body: '#8bc34a', label: '#558b2f', cap: '#33691e', accent: '#c5e1a5' },

  // ── Legumes & plant-based proteins ───────────────────────────────────────
  blackBeanK:  { body: '#3e2f2a', label: '#5d4a42', cap: '#241a17', accent: '#6d5850' },
  kidneyBeanK: { body: '#8d2f2f', label: '#a84444', cap: '#5c1f1f', accent: '#c17a7a' },
  chickpeaK:   { body: '#e8d3a0', label: '#d4b876', cap: '#a8895a', accent: '#f5e8c8' },
  lentilK:     { body: '#c9682f', label: '#a85220', cap: '#7a3d17', accent: '#e0a06b' },
  tempehK:     { body: '#e8dcb8', label: '#c9b98a', cap: '#a1927a', accent: '#f5eeda' },
  seitanK:     { body: '#8a5a3a', label: '#6d4527', cap: '#4e321c', accent: '#b58259' },
  hummusK:     { body: '#f0e2b6', label: '#d9c48a', cap: '#b8a06a', accent: '#faf3d8' },

  // ── Catalog expansion 2026-07-16 — more produce/fruit/pantry variety ─────
  beetK:        { body: '#ad1457', label: '#880e4f', cap: '#4a0026', accent: '#d81b60' },
  eggplantK:    { body: '#4a148c', label: '#6a1b9a', cap: '#311b52', accent: '#7b1fa2' },
  grapeK:       { body: '#6a1b9a', label: '#8e24aa', cap: '#4a148c', accent: '#ab47bc' },
  peachK:       { body: '#ffab91', label: '#ff7043', cap: '#d84315', accent: '#ffccbc' },
  tropicalK:    { body: '#ffca28', label: '#ff8f00', cap: '#e65100', accent: '#ffe082' },
  melonK:       { body: '#aed581', label: '#7cb342', cap: '#33691e', accent: '#dcedc8' },
  driedFruitK:  { body: '#8d6e42', label: '#6d4c2f', cap: '#4e342e', accent: '#c9a876' },
  nutK:         { body: '#b08968', label: '#8d6e42', cap: '#6d4c2f', accent: '#dcc9a3' },
  seedK:        { body: '#7c8a3c', label: '#556b2f', cap: '#33691e', accent: '#aed581' },
  teaK:         { body: '#4e7a3d', label: '#2e5c22', cap: '#1b3a14', accent: '#7cb342' },
  snackK:       { body: '#e8c07d', label: '#c9a256', cap: '#a8823a', accent: '#f5dca3' },
};

// Sentinel: spice jars use a hashed palette so the many small-jar spices
// (paprika, cumin, oregano, curry…) read as a colourful spice rack instead of
// one repeated jar. Resolved in spriteSpec(), not at TABLE-definition time.
const SPICE_HASH_MARKER = '__spice_hash__';
const SPICE_PALETTES = [P.spiceRed, P.spiceGreen, P.spiceGold, P.spiceBrown];

// ── Keyword table (ordered: specific first) ───────────────────────────────────
// Each entry: { kw:[...], kind, shape?, palette }. First match wins.
const TABLE = [
  // Pantry compounds that would otherwise be shadowed by the bare 'soda' mixer
  // keyword just below (e.g. "baking soda" whole-word-matches 'soda') — must
  // be checked first per this table's own "compounds before shadowing singles"
  // convention (see the kitchen section's header comment further down).
  { kw: ['baking soda', 'baking powder', 'powdered sugar'], kind: 'drygood', shape: 'box', palette: P.bakingBox },

  // Juices/mixers that are cartons/cans — checked BEFORE citrus 'orange'/'lemon'
  { kw: ['orange juice', 'cranberry juice', 'pineapple juice', 'tomato juice', 'grapefruit juice', 'apple juice'], kind: 'can', palette: P.can },
  { kw: ['soda water', 'club soda', 'seltzer', 'sparkling water', 'tonic', 'tonic water', 'cola', 'coke', 'ginger beer', 'ginger ale', 'soda', 'lemonade', 'energy drink'], kind: 'can', palette: P.can },

  // Citrus (fruit + citrus juice) — plurals listed explicitly (matches this
  // table's own convention elsewhere, e.g. 'potato'/'potatoes') since word
  // matching is exact-string, not stemmed.
  { kw: ['lime juice', 'lime wedge', 'lime', 'limes'], kind: 'citrus', palette: P.lime },
  { kw: ['lemon juice', 'lemon wedge', 'lemon', 'lemons'], kind: 'citrus', palette: P.lemon },
  { kw: ['orange wedge', 'orange slice', 'orange peel', 'orange', 'oranges'], kind: 'citrus', palette: P.orange },
  { kw: ['grapefruit', 'grapefruits'], kind: 'citrus', palette: P.orange },

  // Herbs
  { kw: ['mint', 'basil', 'rosemary', 'thyme', 'sage', 'cilantro'], kind: 'herb', palette: P.mint },

  // Garnishes
  { kw: ['cherry', 'maraschino cherry', 'raspberry', 'strawberry'], kind: 'garnish', palette: P.cherry },
  // "olive oil" must resolve as an oil bottle, not the olive garnish below —
  // checked here (before the plain 'olive' keyword) since first match wins.
  { kw: ['olive oil'], kind: 'bottle', shape: 'round', palette: P.oil },
  { kw: ['olive', 'cocktail onion'], kind: 'garnish', palette: P.olive },

  // Glassware / tools
  { kw: ['coupe', 'martini glass', 'rocks glass', 'highball', 'tumbler', 'glass', 'glassware', 'shaker', 'jigger'], kind: 'glass', palette: P.glass },

  // Ice / egg / sugar / salt
  { kw: ['ice cube', 'ice cubes', 'crushed ice', 'ice'], kind: 'ice', palette: P.ice },
  { kw: ['egg white', 'egg yolk', 'whole egg', 'egg', 'eggs', 'aquafaba'], kind: 'egg', palette: P.egg },
  { kw: ['simple syrup', 'sugar syrup', 'honey syrup', 'demerara syrup', 'cinnamon syrup', 'vanilla syrup', 'raspberry syrup', 'maple syrup', 'agave nectar', 'agave', 'honey', 'grenadine', 'orgeat'], kind: 'bottle', shape: 'round', palette: P.syrup },
  { kw: ['sugar', 'superfine sugar', 'caster sugar'], kind: 'sugar', palette: P.sugar },

  // Spirits & wine/beer (bottles)
  { kw: ['gin'], kind: 'bottle', shape: 'tall', palette: P.gin },
  { kw: ['vodka'], kind: 'bottle', shape: 'tall', palette: P.vodka },
  { kw: ['bourbon', 'whiskey', 'whisky', 'rye', 'scotch', 'tennessee whiskey'], kind: 'bottle', shape: 'square', palette: P.whiskey },
  { kw: ['tequila', 'mezcal'], kind: 'bottle', shape: 'tall', palette: P.tequila },
  { kw: ['rum', 'bacardi', 'cachaca'], kind: 'bottle', shape: 'round', palette: P.rum },
  { kw: ['cognac', 'brandy', 'armagnac', 'pisco', 'calvados'], kind: 'bottle', shape: 'round', palette: P.brandy },
  { kw: ['dry vermouth', 'sweet vermouth', 'vermouth'], kind: 'bottle', shape: 'tall', palette: P.vermouth },
  // Named liqueur families first (more specific palettes), then generic liqueur
  { kw: ['campari', 'aperol', 'amaro', 'fernet', 'aperitivo', 'negroni', 'select'], kind: 'bottle', shape: 'round', palette: P.amaro },
  { kw: ['baileys', 'irish cream', 'cream liqueur', 'rumchata'], kind: 'bottle', shape: 'round', palette: P.cream },
  { kw: ['kahlua', 'coffee liqueur', 'espresso', 'cold brew', 'coffee', 'tia maria'], kind: 'bottle', shape: 'round', palette: P.coffee },
  { kw: ['chambord', 'cassis', 'creme de cassis', 'crème de cassis', 'raspberry liqueur', 'sloe gin', 'crème de violette', 'creme de violette'], kind: 'bottle', shape: 'round', palette: P.berry },
  { kw: ['midori', 'melon liqueur', 'chartreuse', 'benedictine', 'bénédictine', 'absinthe', 'creme de menthe', 'crème de menthe', 'green chartreuse', 'herbsaint'], kind: 'bottle', shape: 'tall', palette: P.herbal },
  { kw: ['triple sec', 'cointreau', 'curacao', 'curaçao', 'grand marnier', 'orange liqueur', 'liqueur', 'amaretto', 'st-germain', 'st germain', 'elderflower liqueur', 'limoncello', 'frangelico', 'drambuie', 'sambuca', 'schnapps'], kind: 'bottle', shape: 'round', palette: P.liqueur },
  { kw: ['angostura', 'bitters', "peychaud's", 'peychauds'], kind: 'bottle', shape: 'mini', palette: P.bitters },
  { kw: ['champagne', 'prosecco', 'sparkling wine', 'wine', 'sherry', 'port'], kind: 'bottle', shape: 'wine', palette: P.wine },
  { kw: ['beer', 'ale', 'lager', 'stout', 'ipa', 'cider'], kind: 'bottle', shape: 'beer', palette: P.beer },

  // ────────────────────────────────────────────────────────────────────────
  // KITCHEN / PANTRY — appended after every bar keyword so existing bar
  // behavior is 100% unchanged (bar words always win their existing match).
  // Compounds are listed before the single words they could otherwise be
  // shadowed by (e.g. "chicken broth" before plain "chicken", "black pepper"
  // before plain "pepper", "tomato paste" before plain "tomato").
  // ────────────────────────────────────────────────────────────────────────

  // Oils & vinegars ('olive oil' itself is matched earlier, before the olive garnish)
  { kw: ['vegetable oil', 'canola oil', 'sesame oil', 'coconut oil', 'cooking spray', 'apple cider vinegar', 'rice vinegar', 'balsamic', 'vinegar'], kind: 'bottle', shape: 'round', palette: P.oil },

  // Condiments, sauces & broths (compounds before protein/produce singles)
  { kw: ['ketchup', 'salsa', 'bbq sauce', 'hot sauce', 'sriracha', 'tomato paste', 'tomato sauce', 'jam', 'jelly'], kind: 'jar', shape: 'condiment', palette: P.condRed },
  { kw: ['mustard'], kind: 'jar', shape: 'condiment', palette: P.condYellow },
  { kw: ['mayo', 'mayonnaise', 'ranch', 'tahini', 'pesto', 'peanut butter', 'almond butter', 'hummus'], kind: 'jar', shape: 'condiment', palette: P.condWhite },
  { kw: ['soy sauce', 'tamari', 'worcestershire', 'fish sauce', 'oyster sauce', 'hoisin', 'broth', 'stock', 'chicken broth', 'beef broth', 'vegetable broth'], kind: 'can', palette: P.condBrown },

  // Spice jars & shakers (compounds before produce's plain pepper/onion/garlic)
  { kw: ['salt', 'sea salt'], kind: 'shaker', palette: P.saltShaker },
  { kw: ['black pepper', 'white pepper'], kind: 'shaker', palette: P.pepperShaker },
  { kw: ['nutritional yeast'], kind: 'jar', shape: 'spice', palette: P.spiceGold },
  { kw: ['paprika', 'cumin', 'oregano', 'chili powder', 'curry', 'turmeric', 'cayenne', 'bay', 'seasoning', 'italian seasoning', 'garlic powder', 'onion powder', 'red pepper flakes', 'clove', 'cardamom', 'cinnamon', 'nutmeg'], kind: 'jar', shape: 'spice', palette: SPICE_HASH_MARKER },

  // Dairy
  { kw: ['milk', 'coconut milk'], kind: 'dairy', shape: 'carton', palette: P.milk },
  { kw: ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta'], kind: 'dairy', shape: 'wedge', palette: P.cheese },
  { kw: ['yogurt', 'sour cream', 'cream cheese'], kind: 'dairy', shape: 'tub', palette: P.yogurt },
  { kw: ['butter', 'cream', 'heavy cream'], kind: 'dairy', shape: 'stick', palette: P.butterK },

  // Protein
  { kw: ['chicken', 'turkey', 'ham'], kind: 'protein', shape: 'poultry', palette: P.poultry },
  { kw: ['beef', 'steak', 'lamb'], kind: 'protein', shape: 'steak', palette: P.steak },
  { kw: ['pork', 'bacon', 'sausage'], kind: 'protein', shape: 'steak', palette: P.porkK },
  { kw: ['fish', 'salmon', 'tuna'], kind: 'protein', shape: 'fish', palette: P.fishK },
  { kw: ['shrimp', 'crab'], kind: 'protein', shape: 'shrimp', palette: P.shrimpK },
  { kw: ['tofu'], kind: 'protein', shape: 'cube', palette: P.tofuK },
  { kw: ['tempeh'], kind: 'protein', shape: 'cube', palette: P.tempehK },
  { kw: ['seitan'], kind: 'protein', shape: 'steak', palette: P.seitanK },

  // Grains, dry goods & baking
  { kw: ['flour', 'cornstarch'], kind: 'drygood', shape: 'sack', palette: P.flour },
  { kw: ['rice', 'quinoa', 'couscous', 'barley', 'yeast'], kind: 'drygood', shape: 'sack', palette: P.riceK },
  { kw: ['pasta', 'spaghetti', 'noodles', 'oats', 'oatmeal', 'cereal'], kind: 'drygood', shape: 'box', palette: P.pastaK },
  { kw: ['bread', 'breadcrumbs', 'panko'], kind: 'drygood', shape: 'loaf', palette: P.breadK },
  { kw: ['tortilla', 'tortillas'], kind: 'drygood', shape: 'stack', palette: P.tortillaK },
  { kw: ['cocoa', 'chocolate', 'chocolate chips'], kind: 'drygood', shape: 'box', palette: P.cocoaK },
  // (baking soda/powder/powdered sugar moved to the top of TABLE — see comment there)
  { kw: ['vanilla extract', 'vanilla'], kind: 'bottle', shape: 'mini', palette: P.vanillaK },

  // Produce (single words last, after every compound above)
  { kw: ['onion', 'onions', 'garlic'], kind: 'produce', shape: 'bulb', palette: P.onionK },
  { kw: ['ginger'], kind: 'produce', shape: 'bulb', palette: P.potatoK },
  { kw: ['potato', 'potatoes'], kind: 'produce', shape: 'round', palette: P.potatoK },
  { kw: ['carrot', 'carrots'], kind: 'produce', shape: 'long', palette: P.carrotK },
  { kw: ['broccoli'], kind: 'produce', shape: 'cap', palette: P.broccoliK },
  { kw: ['brussels sprouts', 'brussel sprouts'], kind: 'produce', shape: 'round', palette: P.brusselsK },
  { kw: ['cauliflower', 'cabbage'], kind: 'produce', shape: 'round', palette: P.cauliK },
  { kw: ['spinach', 'lettuce', 'kale', 'arugula'], kind: 'produce', shape: 'leafy', palette: P.leafyK },
  { kw: ['parsley'], kind: 'herb', palette: P.mint },
  { kw: ['tomato', 'tomatoes'], kind: 'produce', shape: 'round', palette: P.tomatoK },
  { kw: ['jalapeno', 'jalapeño', 'jalapenos'], kind: 'produce', shape: 'pepper', palette: P.pepperRedK },
  { kw: ['pepper', 'peppers', 'bell pepper', 'bell peppers'], kind: 'produce', shape: 'pepper', palette: P.pepperGreenK },
  { kw: ['corn'], kind: 'produce', shape: 'cob', palette: P.cornK },
  { kw: ['mushroom', 'mushrooms'], kind: 'produce', shape: 'cap', palette: P.mushroomK },
  { kw: ['avocado'], kind: 'produce', shape: 'round', palette: P.avocadoK },
  { kw: ['cucumber', 'zucchini', 'scallion', 'scallions', 'celery'], kind: 'produce', shape: 'long', palette: P.cucumberK },
  { kw: ['squash'], kind: 'produce', shape: 'long', palette: P.squashK },
  // Named legumes checked BEFORE the generic 'beans' below (same first-match
  // rule as everywhere else in this table) so canned/dry beans get their own
  // color instead of the generic pea-green cluster.
  { kw: ['black beans'], kind: 'produce', shape: 'cluster', palette: P.blackBeanK },
  { kw: ['kidney beans'], kind: 'produce', shape: 'cluster', palette: P.kidneyBeanK },
  { kw: ['chickpeas', 'garbanzo beans'], kind: 'produce', shape: 'cluster', palette: P.chickpeaK },
  { kw: ['lentils'], kind: 'produce', shape: 'cluster', palette: P.lentilK },
  { kw: ['edamame'], kind: 'produce', shape: 'cluster', palette: P.edamameK },
  { kw: ['peas', 'beans', 'green beans'], kind: 'produce', shape: 'cluster', palette: P.peaK },
  { kw: ['banana', 'bananas'], kind: 'produce', shape: 'long', palette: P.bananaK },
  { kw: ['apple'], kind: 'produce', shape: 'round', palette: P.appleK },
];

// Deterministic variety for ingredients no keyword matches: hash the name to a
// stable palette + bottle shape, so a "vast" catalog of unknowns still renders
// as a colourful, varied shelf rather than a wall of identical bottles.
const GENERIC_PALETTES = [
  P.generic, P.rum, P.whiskey, P.liqueur, P.vermouth, P.brandy,
  P.gin, P.vodka, P.wine, P.bitters, P.amaro, P.berry, P.herbal, P.tequila,
];
const GENERIC_SHAPES = ['round', 'tall', 'square', 'mini'];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function genericSpec(seed) {
  const h = hashStr(seed || 'x');
  return {
    kind: 'bottle',
    shape: GENERIC_SHAPES[h % GENERIC_SHAPES.length],
    palette: GENERIC_PALETTES[h % GENERIC_PALETTES.length],
    glow: false,
  };
}

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
        const palette = entry.palette === SPICE_HASH_MARKER
          ? SPICE_PALETTES[hashStr(source) % SPICE_PALETTES.length]
          : entry.palette;
        return {
          kind: entry.kind,
          shape: entry.shape || null,
          palette,
          glow: false,
        };
      }
    }
  }
  return genericSpec(canon || raw);
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

// ── Kitchen renderers ─────────────────────────────────────────────────────────

function Dairy({ shape, c, s }) {
  const { body, label, cap, accent } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'carton') return (
    <svg width={s * 0.6} height={s} viewBox="0 0 20 32" className={cls} style={px}>
      <path d="M4 6 L10 0 L16 6 L16 30 L4 30 Z" fill={body} stroke={cap} strokeWidth="0.5" />
      <rect x="4" y="14" width="12" height="8" fill={label} opacity="0.7" />
      <rect x="5" y="7" width="2" height="21" fill="rgba(255,255,255,0.3)" />
    </svg>
  );
  if (shape === 'wedge') return (
    <svg width={s * 0.7} height={s * 0.6} viewBox="0 0 24 18" className={cls} style={px}>
      <path d="M0 18 L20 18 L24 0 Z" fill={body} />
      <circle cx="8" cy="13" r="1.2" fill={cap} opacity="0.5" />
      <circle cx="14" cy="9" r="1" fill={cap} opacity="0.5" />
    </svg>
  );
  if (shape === 'tub') return (
    <svg width={s * 0.6} height={s * 0.55} viewBox="0 0 20 16" className={cls} style={px}>
      <path d="M2 2 L18 2 L16 16 L4 16 Z" fill={body} />
      <rect x="1" y="0" width="18" height="3" fill={cap} rx="1" />
      <rect x="4" y="5" width="12" height="5" fill={label} opacity="0.6" />
    </svg>
  );
  // stick (butter/cream)
  return (
    <svg width={s * 0.7} height={s * 0.45} viewBox="0 0 24 14" className={cls} style={px}>
      <rect x="1" y="1" width="22" height="12" fill={body} rx="1" />
      <rect x="1" y="1" width="6" height="12" fill={accent} opacity="0.6" />
      <rect x="17" y="1" width="6" height="12" fill={accent} opacity="0.6" />
    </svg>
  );
}

function Protein({ shape, c, s }) {
  const { body, label, cap, accent } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'poultry') return (
    <svg width={s * 0.6} height={s * 0.7} viewBox="0 0 20 22" className={cls} style={px}>
      <ellipse cx="10" cy="8" rx="8" ry="7" fill={body} />
      <rect x="8" y="13" width="4" height="9" fill={cap} rx="2" />
      <circle cx="6" cy="6" r="1.5" fill={accent} opacity="0.5" />
    </svg>
  );
  if (shape === 'fish') return (
    <svg width={s * 0.75} height={s * 0.5} viewBox="0 0 26 16" className={cls} style={px}>
      <ellipse cx="15" cy="8" rx="10" ry="6" fill={body} />
      <path d="M6 8 L0 2 L0 14 Z" fill={cap} />
      <circle cx="21" cy="6" r="1" fill="#000000" opacity="0.6" />
      <rect x="9" y="7" width="10" height="1.5" fill={label} opacity="0.5" />
    </svg>
  );
  if (shape === 'shrimp') return (
    <svg width={s * 0.6} height={s * 0.5} viewBox="0 0 20 16" className={cls} style={px}>
      <path d="M2 14 Q2 2 16 4 Q18 6 14 8 Q10 10 8 14 Z" fill={body} />
      <circle cx="16" cy="4" r="1.2" fill={cap} />
    </svg>
  );
  if (shape === 'cube') return (
    <svg width={s * 0.55} height={s * 0.55} viewBox="0 0 18 18" className={cls} style={px}>
      <rect x="1" y="1" width="16" height="16" fill={body} stroke={cap} strokeWidth="0.6" />
      <rect x="4" y="4" width="4" height="4" fill={accent} opacity="0.4" />
      <rect x="10" y="10" width="4" height="4" fill={accent} opacity="0.4" />
    </svg>
  );
  // steak (default)
  return (
    <svg width={s * 0.65} height={s * 0.55} viewBox="0 0 22 18" className={cls} style={px}>
      <rect x="1" y="1" width="20" height="16" fill={body} rx="3" />
      <path d="M4 5 L18 5 M4 9 L18 9 M4 13 L18 13" stroke={label} strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function DryGood({ shape, c, s }) {
  const { body, label, cap, accent } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'sack') return (
    <svg width={s * 0.6} height={s * 0.85} viewBox="0 0 20 30" className={cls} style={px}>
      <path d="M6 2 Q10 -1 14 2 L16 26 Q10 30 4 26 Z" fill={body} />
      <rect x="7" y="0" width="6" height="4" fill={cap} />
      <rect x="5" y="12" width="10" height="7" fill={label} opacity="0.5" />
    </svg>
  );
  if (shape === 'box') return (
    <svg width={s * 0.6} height={s * 0.8} viewBox="0 0 20 26" className={cls} style={px}>
      <rect x="1" y="1" width="18" height="24" fill={body} rx="1" />
      <rect x="3" y="9" width="14" height="9" fill={label} opacity="0.65" />
      <rect x="1" y="1" width="18" height="4" fill={cap} />
    </svg>
  );
  if (shape === 'loaf') return (
    <svg width={s * 0.7} height={s * 0.55} viewBox="0 0 24 18" className={cls} style={px}>
      <path d="M2 18 L2 8 Q12 -2 22 8 L22 18 Z" fill={body} />
      <path d="M4 18 L4 10 Q12 2 20 10 L20 18 Z" fill={label} opacity="0.4" />
    </svg>
  );
  // stack (tortillas)
  return (
    <svg width={s * 0.7} height={s * 0.5} viewBox="0 0 24 16" className={cls} style={px}>
      <ellipse cx="12" cy="13" rx="11" ry="2.6" fill={body} />
      <ellipse cx="12" cy="9" rx="11" ry="2.6" fill={accent} />
      <ellipse cx="12" cy="5" rx="11" ry="2.6" fill={body} />
    </svg>
  );
}

function Jar({ shape, c, s }) {
  const { body, label, cap, accent } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'condiment') return (
    <svg width={s * 0.5} height={s * 0.85} viewBox="0 0 16 28" className={cls} style={px}>
      <rect x="6" y="0" width="4" height="4" fill={cap} />
      <path d="M4 4 L12 4 L14 10 L14 26 L2 26 L2 10 Z" fill={body} />
      <rect x="3" y="14" width="10" height="8" fill={accent} opacity="0.35" />
    </svg>
  );
  // spice jar
  return (
    <svg width={s * 0.5} height={s * 0.6} viewBox="0 0 16 20" className={cls} style={px}>
      <rect x="4" y="0" width="8" height="3" fill={cap} />
      <rect x="1" y="3" width="14" height="17" fill={body} rx="1" />
      <rect x="3" y="8" width="10" height="7" fill={label} opacity="0.6" />
      <rect x="6" y="1" width="1" height="1.4" fill="#000000" opacity="0.4" />
      <rect x="9" y="1" width="1" height="1.4" fill="#000000" opacity="0.4" />
    </svg>
  );
}

function Shaker({ c, s }) {
  const { body, label, cap } = c;
  return (
    <svg width={s * 0.45} height={s * 0.75} viewBox="0 0 14 24" className="bar-sprite-svg" style={px}>
      <rect x="4" y="0" width="6" height="3" fill={cap} />
      <path d="M3 3 L11 3 L12 22 L2 22 Z" fill={body} />
      <rect x="4" y="1" width="1" height="1" fill={label} />
      <rect x="7" y="1" width="1" height="1" fill={label} />
      <rect x="9" y="1" width="1" height="1" fill={label} />
    </svg>
  );
}

function Produce({ shape, c, s }) {
  const { body, label, cap, accent } = c;
  const cls = 'bar-sprite-svg';
  if (shape === 'bulb') return (
    <svg width={s * 0.55} height={s * 0.6} viewBox="0 0 18 20" className={cls} style={px}>
      <path d="M9 2 L11 6 L9 6 Z" fill={cap} />
      <circle cx="9" cy="13" r="8" fill={body} />
      <path d="M9 5 L9 21" stroke={cap} strokeWidth="1" opacity="0.3" />
    </svg>
  );
  if (shape === 'long') return (
    <svg width={s * 0.4} height={s * 0.85} viewBox="0 0 12 28" className={cls} style={px}>
      <path d="M4 4 L8 4 L9 26 Q6 28 3 26 Z" fill={body} />
      <rect x="3" y="0" width="6" height="4" fill={cap} />
    </svg>
  );
  if (shape === 'leafy') return (
    <svg width={s * 0.65} height={s * 0.6} viewBox="0 0 22 20" className={cls} style={px}>
      <ellipse cx="7" cy="12" rx="7" ry="6" fill={body} />
      <ellipse cx="15" cy="10" rx="7" ry="7" fill={label} />
      <ellipse cx="11" cy="6" rx="5" ry="5" fill={accent} opacity="0.7" />
    </svg>
  );
  if (shape === 'pepper') return (
    <svg width={s * 0.55} height={s * 0.75} viewBox="0 0 18 24" className={cls} style={px}>
      <rect x="7" y="0" width="4" height="4" fill={cap} />
      <path d="M4 5 Q9 2 14 5 Q18 12 13 22 Q9 24 5 22 Q0 12 4 5 Z" fill={body} />
      <ellipse cx="7" cy="9" rx="2" ry="3" fill={accent} opacity="0.4" />
    </svg>
  );
  if (shape === 'cob') return (
    <svg width={s * 0.45} height={s * 0.85} viewBox="0 0 14 28" className={cls} style={px}>
      <path d="M4 2 Q10 -2 12 4 L11 24 Q7 27 3 24 Z" fill={body} />
      <rect x="4" y="6" width="2" height="2" fill={label} opacity="0.6" />
      <rect x="8" y="8" width="2" height="2" fill={label} opacity="0.6" />
      <rect x="4" y="12" width="2" height="2" fill={label} opacity="0.6" />
      <rect x="8" y="14" width="2" height="2" fill={label} opacity="0.6" />
      <rect x="4" y="18" width="2" height="2" fill={label} opacity="0.6" />
    </svg>
  );
  if (shape === 'cap') return (
    <svg width={s * 0.6} height={s * 0.55} viewBox="0 0 20 18" className={cls} style={px}>
      <path d="M2 10 Q2 0 10 0 Q18 0 18 10 Z" fill={body} />
      <rect x="8" y="10" width="4" height="8" fill={cap} />
      <ellipse cx="10" cy="10" rx="9" ry="2" fill={label} opacity="0.5" />
    </svg>
  );
  if (shape === 'round') return (
    <svg width={s * 0.6} height={s * 0.6} viewBox="0 0 20 20" className={cls} style={px}>
      <circle cx="10" cy="11" r="9" fill={body} />
      <rect x="9" y="0" width="2" height="3" fill={cap} />
      <circle cx="7" cy="8" r="2" fill={accent} opacity="0.4" />
    </svg>
  );
  // cluster (peas/beans)
  return (
    <svg width={s * 0.6} height={s * 0.4} viewBox="0 0 20 14" className={cls} style={px}>
      <circle cx="5" cy="7" r="4" fill={body} />
      <circle cx="12" cy="5" r="4" fill={label} />
      <circle cx="16" cy="9" r="3.5" fill={body} />
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
    case 'can':      inner = <Can c={c} s={size} />; break;
    case 'citrus':   inner = <Citrus c={c} s={size} />; break;
    case 'herb':     inner = <Herb c={c} s={size} />; break;
    case 'garnish':  inner = <Garnish c={c} s={size} />; break;
    case 'glass':    inner = <Glass c={c} s={size} />; break;
    case 'ice':      inner = <Ice c={c} s={size} />; break;
    case 'egg':      inner = <Egg c={c} s={size} />; break;
    case 'sugar':    inner = <Sugar c={c} s={size} />; break;
    case 'dairy':    inner = <Dairy shape={spec.shape} c={c} s={size} />; break;
    case 'protein':  inner = <Protein shape={spec.shape} c={c} s={size} />; break;
    case 'drygood':  inner = <DryGood shape={spec.shape} c={c} s={size} />; break;
    case 'jar':      inner = <Jar shape={spec.shape} c={c} s={size} />; break;
    case 'shaker':   inner = <Shaker c={c} s={size} />; break;
    case 'produce':  inner = <Produce shape={spec.shape} c={c} s={size} />; break;
    case 'bottle':
    default:         inner = <Bottle shape={spec.shape} c={c} s={size} />; break;
  }
  return <span className={wrapCls} title={name}>{inner}</span>;
}

export default { spriteSpec, IngredientSprite };
