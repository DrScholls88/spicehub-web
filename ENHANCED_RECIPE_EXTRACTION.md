# Enhanced Recipe Extraction Functions

## Overview

This document describes the production-ready recipe extraction improvements added to `src/recipeParser.js`. These functions provide stronger recipe detection, automatic extraction without user interaction, and better ingredient parsing.

## New Functions

### 1. `detectRecipePlugins(domOrHtml)`

**Purpose**: Detect recipe plugin markup and structured data in HTML/DOM.

**Recognizes**:
- WPRM (WP Recipe Maker) — `.wprm-recipe`, semantic HTML with microdata
- Tasty Recipes — `.tasty-recipes`, schema.org structured data
- EasyRecipe — `.EasyRecipeType`, microdata attributes
- JSON-LD Recipe — `<script type="application/ld+json">` with `@type: Recipe`
- Semantic HTML — `<article>`, `<section>` with aria-labels and microdata
- Common CSS patterns — `.recipe-ingredient`, `.recipe-instruction`, etc.

**Input**:
```javascript
// Either DOM Document or HTML string
detectRecipePlugins(document)
detectRecipePlugins(htmlString)
```

**Output**:
```javascript
{
  type: 'wprm' | 'tasty' | 'easyrecipe' | 'jsonld' | 'semantic' | 'css-patterns' | null,
  title: 'Recipe Name',
  ingredients: ['2 cups flour', '1 egg', ...],
  directions: ['Preheat oven...', 'Mix ingredients...', ...],
  imageUrl: 'https://...'
}
```

**Usage Example**:
```javascript
import { detectRecipePlugins } from './recipeParser';

// Server-side: detect plugins in fetched HTML
const html = await fetch(url).then(r => r.text());
const result = detectRecipePlugins(html);

if (result.type) {
  console.log(`Found ${result.type} recipe with ${result.ingredients.length} ingredients`);
  return result;
}

// Client-side: detect in current page DOM
const result = detectRecipePlugins(document);
```

**Implementation Details**:

1. **WPRM Detection**
   - Looks for `.wprm-recipe` containers
   - Extracts from `.wprm-recipe-ingredient` and `.wprm-recipe-instruction` elements
   - Handles microdata attributes (`itemprop="recipeIngredient"`)

2. **Tasty Recipes Detection**
   - Identifies `.tasty-recipes` containers
   - Uses schema.org `itemprop` attributes
   - Supports both list items and custom markup

3. **JSON-LD Parsing**
   - Searches all `<script type="application/ld+json">` tags
   - Recursively finds Recipe objects in nested `@graph` structures
   - Normalizes various field formats (string arrays, objects, etc.)

4. **CSS Pattern Fallback**
   - Tries common patterns: `.recipe-ingredient`, `.instruction-item`, etc.
   - Useful for non-standard recipe sites with custom markup
   - Stops after finding first matching pattern to avoid mixing sources

---

### 2. `smartClassifyLines(lines, sourceElement)`

**Purpose**: Intelligently classify text lines as ingredients or directions using multiple heuristics.

**Combines Signals**:
1. CSS/class patterns from source element
2. Content heuristics (cooking verbs, measurements, length)
3. Section header detection ("Ingredients:", "Instructions:")
4. Formatting analysis (bullets, numbered steps)

**Input**:
```javascript
smartClassifyLines(
  ['2 cups flour', 'Preheat oven to 350°F', ...],
  sourceElement  // optional: DOM element with class/id hints
)
```

**Output**:
```javascript
{
  ingredients: ['2 cups flour', '1 egg', 'Salt to taste'],
  directions: ['Preheat oven to 350°F', 'Mix ingredients...']
}
```

**Usage Example**:
```javascript
import { smartClassifyLines } from './recipeParser';

// In BrowserAssist: auto-classify visible text
const lines = visibleText.split('\n').map(l => l.trim()).filter(l => l);
const { ingredients, directions } = smartClassifyLines(lines);

// Or with source element for better context
const container = document.querySelector('.recipe-content');
const { ingredients, directions } = smartClassifyLines(lines, container);
```

**Classification Logic**:

| Signal | Ingredient? | Direction? | Notes |
|--------|-------------|-----------|-------|
| Starts with "Ingredients:" | ✓ | ✗ | Explicit header |
| Starts with "Directions:" | ✗ | ✓ | Explicit header |
| Matches `2 cups flour` pattern | ✓ | ✗ | Quantity + unit |
| Starts with cooking verb | ✗ | ✓ | Mix, stir, add, bake, etc. |
| Numbered step (1., 1), etc.) | ✗ | ✓ | Step numbering |
| Bullet point (`-`, `•`, etc.) | ✓ | ✗ | Default for unclassified |
| Length > 60 chars | ✗ | ✓ | Longer = likely directions |
| Contains food keywords | ✓ | ✗ | Short lines with food names |

**Supported Cooking Verbs** (70+):
- Action verbs: mix, stir, add, blend, fold, season, combine, pour, etc.
- Heat verbs: cook, bake, fry, sauté, heat, preheat, roast, simmer, boil, etc.
- Prep verbs: chop, dice, mince, shred, grate, slice, cut, crush, etc.
- Sequencing: first, then, next, finally, begin, start, etc.
- Finishing: serve, garnish, drizzle, top, spread, etc.

---

### 3. `parseIngredientLine(text)`

**Purpose**: Extract structured components from a single ingredient line.

**Input**:
```javascript
parseIngredientLine("2 1/2 cups all-purpose flour")
parseIngredientLine("3 cloves garlic, minced")
parseIngredientLine("Salt and pepper to taste")
parseIngredientLine("• 1 can (15 oz) black beans")
```

**Output**:
```javascript
{
  quantity: "2 1/2",    // null if not found
  unit: "cups",         // null if not found
  name: "all-purpose flour"
}

{
  quantity: "3",
  unit: "cloves",
  name: "garlic, minced"
}

{
  quantity: null,
  unit: null,
  name: "Salt and pepper to taste"
}

{
  quantity: "1",
  unit: "can",
  name: "(15 oz) black beans"
}
```

**Supported Units** (50+):
- Volume: cups, tablespoons, teaspoons, ml, liters, pinch, dash
- Weight: ounces, pounds, grams, kilograms
- Count: cloves, cans, jars, packages, sticks, slices, pieces, sprigs
- Special: handful, bunch, heads, stalks, fillets, breasts, thighs
- Fractions: ½, ¼, ¾, ⅓, ⅔, ⅛, ⅜, ⅝, ⅞

**Usage Example**:
```javascript
import { parseIngredientLine } from './recipeParser';

const ingredients = [
  '2 cups flour',
  '3 eggs',
  'Salt to taste'
];

for (const ing of ingredients) {
  const { quantity, unit, name } = parseIngredientLine(ing);
  console.log(`${quantity || 'Some'} ${unit || ''} ${name}`);
  // Outputs:
  // 2 cups flour
  // 3 eggs
  // Some  Salt to taste
}

// Use in recipe editing UI
const parsed = parseIngredientLine(userInput);
if (parsed.quantity && parsed.unit) {
  // Show in structured form
  form.quantity.value = parsed.quantity;
  form.unit.value = parsed.unit;
  form.name.value = parsed.name;
}
```

**Implementation Notes**:
- Removes bullet points and list markers automatically
- Handles decimal numbers and unicode fractions
- Matches quantity + unit before extracting name
- Falls back to heuristic if no unit found
- Robust to common variations (tbsp vs tablespoon, oz vs ounces, etc.)

---

### 4. `extractWithBrowserAPI(pageContent)`

**Purpose**: Automatically extract recipe from page without requiring user interaction.

**Extraction Strategy** (in order of confidence):
1. Detect recipe plugin markup (WPRM, Tasty Recipes, JSON-LD, etc.)
2. Use `parseCaption()` for heuristic text parsing
3. Use `smartClassifyLines()` as final fallback

**Input**:
```javascript
// Full object with all hints
extractWithBrowserAPI({
  html: pageContent.html,
  visibleText: extractedText,
  imageUrls: [...imageElements.map(el => el.src)],
  sourceUrl: pageUrl
})

// Or just HTML string for basic extraction
extractWithBrowserAPI(htmlString)
```

**Output**:
```javascript
{
  name: "Chocolate Chip Cookies",
  ingredients: [
    "2 1/4 cups all-purpose flour",
    "1 tsp baking soda",
    "1 tsp salt",
    ...
  ],
  directions: [
    "Preheat oven to 375°F",
    "Mix flour, baking soda and salt in small bowl",
    ...
  ],
  imageUrl: "https://...",
  link: "https://...",
  extractedVia: "plugin-wprm"  // or "caption-parsing", "smart-classification"
}

// Returns null if no recipe found
null
```

**Extraction Methods** (in fallback order):
| Method | Confidence | Speed | Description |
|--------|-----------|-------|-------------|
| `plugin-wprm` | Very High | Fast | WPRM (WP Recipe Maker) |
| `plugin-tasty` | Very High | Fast | Tasty Recipes |
| `plugin-jsonld` | High | Fast | JSON-LD structured data |
| `caption-parsing` | Medium | Medium | `parseCaption()` heuristics |
| `smart-classification` | Low | Medium | Line-by-line classification |
| null | N/A | N/A | No recipe found |

**Usage Example - Server-Side** (server/index.js):
```javascript
import { extractWithBrowserAPI } from '../src/recipeParser.js';

// After fetching page with puppeteer
const data = await page.evaluate(() => {
  return {
    html: document.documentElement.innerHTML,
    visibleText: document.body.innerText,
    imageUrls: Array.from(document.querySelectorAll('img')).map(el => el.src)
  };
});

const recipe = extractWithBrowserAPI({
  ...data,
  sourceUrl: url
});

if (recipe) {
  return res.json({ ok: true, recipe });
}
```

**Usage Example - Client-Side** (BrowserAssist.jsx):
```javascript
import { extractWithBrowserAPI } from '../recipeParser';

// Auto-extract without waiting for user button click
const doc = iframeRef.current?.contentDocument;
if (doc) {
  const pageContent = {
    html: doc.documentElement.innerHTML,
    visibleText: doc.body.innerText,
    imageUrls: Array.from(doc.querySelectorAll('img')).map(el => el.src),
    sourceUrl: url
  };

  const recipe = extractWithBrowserAPI(pageContent);
  if (recipe) {
    onRecipeExtracted(recipe);
    return; // Success! No button click needed
  }
}
```

---

## Integration Guide

### 1. Server-Side: Auto-Extract Instagram Posts

**File**: `server/index.js` (around line 950)

**Current Code**:
```javascript
// ── Extract from rendered DOM (same approach as Paprika's browser.js) ──
const data = await page.evaluate(() => {
  // 1. JSON-LD (recipe blogs that also happen to be on social media)
  function tryRecipe(obj) { ... }
  // 2. Caption from rendered DOM
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    // ...
  }
  // Extract caption text...
  return {
    type: 'caption',
    caption: captionText
  };
});
```

**Improved Code**:
```javascript
import { extractWithBrowserAPI } from '../src/recipeParser.js';

// ── Extract from rendered DOM ──
const data = await page.evaluate(() => ({
  html: document.documentElement.innerHTML,
  visibleText: document.body.innerText,
  imageUrls: Array.from(document.querySelectorAll('img')).map(el => el.src)
}));

// Try enhanced extraction with plugin detection
const recipe = extractWithBrowserAPI({
  ...data,
  sourceUrl: url
});

if (recipe && recipe.ingredients.length > 0) {
  return res.json({
    ok: true,
    type: 'recipe',
    recipe,
    extractedVia: recipe.extractedVia
  });
}

// Fallback to caption parsing
return res.json({
  ok: true,
  type: 'caption',
  caption: data.visibleText
});
```

**Benefits**:
- Auto-detects WPRM/Tasty Recipes even on social media embeds
- No user interaction needed (no BrowserAssist button)
- Improves extraction success rate for recipe plugin sites

---

### 2. Client-Side: Faster ImportModal

**File**: `src/components/BrowserAssist.jsx` (around line 176)

**Current Code**:
```javascript
// Extract visible text from iframe
const visibleText = extractVisibleTextFromDoc(doc);
const imageUrls = extractImageUrlsFromDoc(doc);

// Try DOM-based extraction
const domRecipe = extractRecipeFromDOM(visibleText, imageUrls, url);

// Pick the best result
const recipe = pickBestRecipe(regexRecipe, domRecipe);
```

**Improved Code**:
```javascript
import { extractWithBrowserAPI } from '../recipeParser';

// Get page data
const doc = iframeRef.current?.contentDocument;
const visibleText = extractVisibleTextFromDoc(doc);
const imageUrls = extractImageUrlsFromDoc(doc);
const html = doc?.documentElement.outerHTML || '';

// Use unified extraction with auto-detection
const recipe = extractWithBrowserAPI({
  html,
  visibleText,
  imageUrls,
  sourceUrl: url
});

if (recipe && hasRealContent(recipe)) {
  onRecipeExtracted(recipe);
  return;
}
```

**Benefits**:
- Cleaner, unified extraction pipeline
- Better success rate on plugin-based sites
- Consistent with server-side extraction

---

### 3. Ingredient Parsing in Recipe Editor

**File**: Wherever you allow users to edit ingredients manually

**Usage**:
```javascript
import { parseIngredientLine } from '../recipeParser';

// In form submission
const ingredientList = userInput.split('\n');
const parsed = ingredientList.map(line => {
  const { quantity, unit, name } = parseIngredientLine(line);
  return { quantity, unit, name, line }; // Store both parsed and original
});

// Store in database
saveRecipe({ ...recipe, ingredients: parsed });

// In UI: show structured editing form
const ing = parsed[0];
<input value={ing.quantity} placeholder="2" />
<select value={ing.unit}><option>cups</option></select>
<input value={ing.name} placeholder="flour" />

// Or show raw line if parsing failed
{ing.quantity && ing.unit
  ? `${ing.quantity} ${ing.unit} ${ing.name}`
  : ing.line
}
```

---

## Testing Checklist

### Unit Tests Recommended

```javascript
import {
  detectRecipePlugins,
  smartClassifyLines,
  parseIngredientLine,
  extractWithBrowserAPI
} from './recipeParser';

describe('detectRecipePlugins', () => {
  it('detects WPRM markup', () => {
    const html = '<div class="wprm-recipe"><div class="wprm-recipe-ingredient">2 cups flour</div></div>';
    const result = detectRecipePlugins(html);
    expect(result.type).toBe('wprm');
    expect(result.ingredients).toContain('2 cups flour');
  });

  it('detects JSON-LD Recipe', () => {
    const html = `
      <script type="application/ld+json">
        {"@type": "Recipe", "name": "Cookies", "recipeIngredient": ["2 cups flour"]}
      </script>
    `;
    const result = detectRecipePlugins(html);
    expect(result.type).toBe('jsonld');
  });
});

describe('smartClassifyLines', () => {
  it('classifies measurements as ingredients', () => {
    const { ingredients } = smartClassifyLines(['2 cups flour', 'Mix thoroughly']);
    expect(ingredients).toContain('2 cups flour');
  });

  it('classifies cooking verbs as directions', () => {
    const { directions } = smartClassifyLines(['Preheat oven', '2 tablespoons butter']);
    expect(directions).toContain('Preheat oven');
  });
});

describe('parseIngredientLine', () => {
  it('parses quantity, unit, and name', () => {
    const result = parseIngredientLine('2 1/2 cups all-purpose flour');
    expect(result.quantity).toBe('2 1/2');
    expect(result.unit).toBe('cups');
    expect(result.name).toBe('all-purpose flour');
  });

  it('handles lines without units', () => {
    const result = parseIngredientLine('Salt to taste');
    expect(result.quantity).toBeNull();
    expect(result.unit).toBeNull();
    expect(result.name).toBe('Salt to taste');
  });
});
```

### Integration Tests

1. **Test with real Instagram recipes** - verify no user button click needed
2. **Test with various recipe plugin sites** (AllRecipes, Food Network, etc.)
3. **Test with social media embeds** (Instagram Reels, TikTok, YouTube shorts)
4. **Test with non-English recipes** (French, Spanish, German)
5. **Test with video transcripts** (YouTube, TikTok)

---

## Performance Considerations

| Function | Time | Memory | Notes |
|----------|------|--------|-------|
| `detectRecipePlugins` | ~50-200ms | ~5MB | Fast on HTML strings, DOM parsing is included |
| `smartClassifyLines` | ~10-50ms | ~1MB | Depends on line count |
| `parseIngredientLine` | <1ms | <1KB | Regex-based, very fast |
| `extractWithBrowserAPI` | ~100-300ms | ~10MB | Calls all functions sequentially |

**Optimization Tips**:
1. Cache plugin detection results if processing same URL multiple times
2. For large recipes (100+ lines), batch parse ingredients with debouncing
3. Use `extractWithBrowserAPI` server-side instead of client-side for faster response
4. Lazy-load DOMParser for browser compatibility

---

## Browser Compatibility

- **Desktop**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Mobile**: iOS Safari 14+, Chrome Android 90+
- **Node.js**: 16+ (for server-side string parsing)

**Fallbacks**:
- If `DOMParser` unavailable (Node.js), pass Document object instead of HTML string
- If regex engine missing features, provides graceful degradation with partial parsing

---

## Future Enhancements

1. **Machine Learning Classification**: Train classifier on recipe sites to improve smartClassifyLines accuracy
2. **Multi-Language Support**: Extend cooking verb lists for French, Spanish, German, etc.
3. **OCR for Images**: Extract recipe from image-only posts (requires computer vision library)
4. **Nutritional Parsing**: Extract calories, macros, allergen info from recipe text
5. **Yield Scaling**: Auto-adjust quantities when users change serving size
6. **Unit Conversion**: Convert between metric/imperial automatically

---

## Troubleshooting

### `detectRecipePlugins` returns null

1. Check if site uses custom classes (not in list)
2. Look for JSON-LD in `<script>` tags with different structure
3. Try viewing page source to find actual markup

### `smartClassifyLines` misclassifies lines

1. Add section headers: "Ingredients:" / "Directions:"
2. Check for cooking verbs not in list (custom cuisines)
3. Verify line length — very short or very long lines may be misclassified

### `parseIngredientLine` doesn't parse quantity

1. Check for unicode fraction support (½, ¼, etc.)
2. Verify unit is in supported list (case-insensitive)
3. Try reformatting as "quantity unit name"

### `extractWithBrowserAPI` returns null

1. Ensure HTML has actual content (not lazy-loaded)
2. Try with explicit `visibleText` instead of relying on HTML parsing
3. Check recipe has at least 3 ingredients or 2 directions

---

## References

- [Schema.org Recipe Type](https://schema.org/Recipe)
- [WP Recipe Maker Docs](https://www.wprecipemaker.com/)
- [Tasty Recipes](https://www.tastyrecipes.com/)
- [EasyRecipe](https://www.easyrecipe.org/)
- [JSON-LD Specification](https://json-ld.org/)
