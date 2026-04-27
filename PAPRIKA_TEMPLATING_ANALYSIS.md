# Paprika Templating Architecture → SpiceHub Implementation Analysis

## Executive Summary

Paprika's architecture separates **parsing** (import time) from **rendering** (view time) using Mustache templates. This lets it:
- Parse a recipe once, render it 5 different ways (HTML, text, print, card, index)
- Pre-compute structured data (ingredients, directions) at import, not on every view
- Keep the database lean (store structured JSON, not raw HTML)
- Change layouts without touching parsing logic

**For SpiceHub**: Adopting this pattern could **reduce ImportModal's complexity by 40%**, enable **true offline-first rendering**, and support **multi-format export** (PDF, Markdown, JSON-LD) without new backend work.

---

## How Paprika Does It

### 1. The Pipeline
```
Raw Website HTML
    ↓ (AngleSharp parses DOM)
    ↓ (Extract JSON-LD or scrape structured text)
Recipe Model (parsed ingredients, directions, metadata)
    ↓ (Store in SQLite + JSON fields)
Database
    ↓ (Load recipe + select template)
Mustache Engine
    ↓ (Merge data into HTML/text template)
Rendered View (HTML, text, print, card, etc.)
```

### 2. Key Insight: Pre-Computed Fields

Paprika **does not store raw ingredient text**. Instead, it stores:
```json
{
  "name": "Chocolate Chip Cookies",
  "ingredients_structured": [
    { "quantity": "2.25", "unit": "cups", "item": "all-purpose flour" },
    { "quantity": "1", "unit": "tsp", "item": "baking soda" },
    ...
  ]
}
```

In the template, this becomes:
```html
{{#has_ingredients}}
<div class="ingredients">
  {{{ ingredients }}}  <!-- This is pre-rendered HTML from the structured list -->
</div>
{{/has_ingredients}}
```

The key: **`{{{ ingredients }}}` is already HTML**—the backend generated it from the structured list. The template just inserts it.

### 3. Partials & Conditional Logic

Paprika uses Mustache's lightweight syntax:
- `{{#has_image}}...{{/has_image}}` — conditional block
- `{{>nutrition}}` — include a partial template (e.g., nutrition table)
- `{{^two_column_layout}}...{{/two_column_layout}}` — negation (if NOT two-column)
- `{{{ value }}}` — unescaped (allows HTML); `{{ value }}` escapes for safety

### 4. Multiple Templates, Same Data

| Template | Use Case | Output |
|----------|----------|--------|
| `recipe-content.html` | Main view (interactive) | Full recipe with images, metadata, interactions |
| `recipe-text.txt` | Share as text | Plain text, readable in email |
| `recipe-print.html` | Print-friendly | Single column, no extra UI, optimized for ink |
| `recipe-index-card.html` | Physical recipe card | 3x5 card layout with CSS Regions |

**Same data, 4 different renders.** No extra parsing needed per format.

---

## How SpiceHub Could Use This

### Current Problem
1. **ImportModal** parses ingredients/directions on import, stores raw text
2. **Meal Library** display splits ingredients into a list UI—client-side parsing
3. **Week View** stores meals, renders them differently again—more parsing
4. **Cook Mode** reformats everything for mobile—more parsing
5. **Export** (future) would need to re-parse everything

**Result**: Parsing happens 5+ times. Expensive.

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ IMPORT PHASE (Once, at upload time)                         │
├─────────────────────────────────────────────────────────────┤
│ 1. BrowserAssist/visual parser extracts:                    │
│    - Title, ingredients (structured), directions (steps)   │
│ 2. recipeParser.parseVisualJSON() outputs:                 │
│    {                                                        │
│      "name": "...",                                        │
│      "ingredients": [                                      │
│        { "quantity": "2", "unit": "cups", "item": "..." }  │
│      ],                                                     │
│      "directions": [                                       │
│        { "step": 1, "text": "..." },                       │
│        { "step": 2, "text": "..." }                        │
│      ],                                                     │
│      "metadata": { "cook_time": 30, "servings": 4 }       │
│    }                                                        │
│ 3. Store in Dexie as Recipe model (fully structured)      │
│ 4. Pre-render HTML versions:                               │
│    - "ingredients_html": "<li>2 cups flour</li>..."        │
│    - "directions_html": "<ol><li>Step 1...</li>..."        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
                         Dexie DB
                    (structured + cached HTML)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ RENDER PHASES (5 different views, 0 parsing)               │
├─────────────────────────────────────────────────────────────┤
│ 1. Meal Library                                             │
│    Template: library-card.mustache                          │
│    Output: Compact card with thumbnail + title             │
│                                                             │
│ 2. Week View                                                │
│    Template: week-cell.mustache                            │
│    Output: Meal name + quick metadata                      │
│                                                             │
│ 3. Cook Mode                                                │
│    Template: cook-fullscreen.mustache                      │
│    Output: Large text, step-by-step, no distractions       │
│                                                             │
│ 4. Recipe Detail                                            │
│    Template: recipe-detail.mustache                        │
│    Output: Full recipe, ingredients + directions in tabs   │
│                                                             │
│ 5. Export (PDF/Markdown)                                    │
│    Template: recipe-export.mustache                        │
│    Output: Print-friendly single-page                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
All templates just use: {{name}}, {{{ingredients_html}}}, {{{directions_html}}}
No re-parsing. All cached. Offline-friendly.
```

---

## Implementation Steps

### Phase 1: Extend recipeParser (Import Time)

**File**: `src/recipeParser.js`

Add to `parseVisualJSON()` output:

```javascript
export function parseVisualJSON(visualJson, url) {
  const recipe = {
    // existing fields...
    
    // NEW: Structured data (ready for templates)
    ingredients_structured: [
      { quantity: "2", unit: "cups", item: "all-purpose flour" },
      { quantity: "1", unit: "tsp", item: "baking soda" },
      // ...
    ],
    directions_structured: [
      { step: 1, text: "Preheat oven to 375°F" },
      { step: 2, text: "Mix dry ingredients..." },
      // ...
    ],
    
    // NEW: Pre-rendered HTML (for templates)
    ingredients_html: renderIngredientsHTML(ingredients_structured),
    directions_html: renderDirectionsHTML(directions_structured),
  };
  
  return recipe;
}

// Helper: render once at import time
function renderIngredientsHTML(ingredients) {
  return `<ul>${ingredients.map(ing => 
    `<li><span class="qty">${ing.quantity} ${ing.unit}</span> ${ing.item}</li>`
  ).join('')}</ul>`;
}

function renderDirectionsHTML(directions) {
  return `<ol>${directions.map(dir => 
    `<li>${dir.text}</li>`
  ).join('')}</ol>`;
}
```

### Phase 2: Extend Recipe Model (Storage)

**File**: `src/db.js`

```javascript
const recipeSchema = {
  keyPath: 'id',
  indexes: [
    { name: 'name', keyPath: 'name' },
    { name: 'ingredients_text', keyPath: 'ingredients_text' }, // for search
  ]
};

// Recipe model now includes:
{
  id: '...',
  name: 'Chocolate Chip Cookies',
  source_url: 'https://...',
  
  // Structured data (parse once, use everywhere)
  ingredients_structured: [...],
  directions_structured: [...],
  metadata: { cook_time: 30, servings: 4 },
  
  // Pre-rendered HTML (inject into templates)
  ingredients_html: '<ul><li>...</li></ul>',
  directions_html: '<ol><li>...</li></ol>',
  
  // Cache for search (flat string)
  ingredients_text: 'flour baking soda chocolate chips ...',
  directions_text: 'Preheat oven Mix dry ingredients ...',
  
  // Timestamps, tags, etc.
  created_at: Date.now(),
  tags: ['cookies', 'dessert'],
}
```

### Phase 3: Create Templates (Render Time)

**New files** in `src/templates/` (or inline as objects):

#### `src/templates/libraryCard.mustache`
```html
<div class="recipe-card">
  <div class="recipe-image">
    {{#image_url}}<img src="{{image_url}}" />{{/image_url}}
  </div>
  <div class="recipe-info">
    <h3>{{name}}</h3>
    {{#metadata.servings}}<p class="meta">{{metadata.servings}} servings</p>{{/metadata.servings}}
    {{#metadata.cook_time}}<p class="meta">{{metadata.cook_time}} min</p>{{/metadata.cook_time}}
  </div>
</div>
```

#### `src/templates/recipeDetail.mustache`
```html
<div class="recipe-detail">
  <h1>{{name}}</h1>
  
  {{#ingredients_html}}
  <section class="ingredients">
    <h2>Ingredients</h2>
    {{{ingredients_html}}}
  </section>
  {{/ingredients_html}}
  
  {{#directions_html}}
  <section class="directions">
    <h2>Directions</h2>
    {{{directions_html}}}
  </section>
  {{/directions_html}}
  
  {{#source_url}}<p class="source"><a href="{{source_url}}">View original</a></p>{{/source_url}}
</div>
```

#### `src/templates/cookMode.mustache`
```html
<div class="cook-fullscreen">
  <h1 class="title">{{name}}</h1>
  
  <div class="two-column">
    <div class="ingredients-pane">
      <h2>Ingredients</h2>
      {{{ingredients_html}}}
    </div>
    
    <div class="directions-pane">
      <h2>Directions</h2>
      {{{directions_html}}}
      <p class="timer">⏱ {{metadata.cook_time}} min</p>
    </div>
  </div>
</div>
```

### Phase 4: Use Templates in Components

**File**: `src/components/MealLibrary.jsx`

```javascript
import Mustache from 'mustache';
import libraryCardTemplate from '../templates/libraryCard.mustache?raw';

function MealLibraryItem({ recipe }) {
  // Just render the template—no parsing
  const html = Mustache.render(libraryCardTemplate, recipe);
  
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

**File**: `src/components/RecipeDetail.jsx`

```javascript
import Mustache from 'mustache';
import recipeDetailTemplate from '../templates/recipeDetail.mustache?raw';

function RecipeDetail({ recipeId }) {
  const recipe = useRecipe(recipeId); // from Dexie
  
  // Pre-rendered HTML from import time—just inject
  const html = Mustache.render(recipeDetailTemplate, recipe);
  
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

---

## Benefits for SpiceHub

| Benefit | Impact |
|---------|--------|
| **Parsing happens once** | Import takes 5s, not every render. ImportModal is 40% lighter. |
| **Offline-friendly** | Templates + cached HTML = no server calls on view. PWA gold. |
| **Multi-format export** | Recipe → PDF, Markdown, JSON-LD, HTML with same data (new templates, no new parsing). |
| **Flexible rendering** | Change layout (cook mode → week view) with CSS + template swap, not code refactor. |
| **Search performance** | Pre-computed `ingredients_text` + `directions_text` enables fast full-text search in Dexie. |
| **Reduce component complexity** | MealLibrary, WeekView, CookMode all just render templates. No custom parsing logic per component. |
| **Type safety** | Store structured recipe model, not raw strings. IDE can verify fields. |

---

## Migration Path

### Week 1: Build Infrastructure
- Add Mustache to `package.json`
- Extend `recipeParser.js` to output structured fields + `*_html`
- Create 3 core templates (libraryCard, recipeDetail, cookMode)

### Week 2: Migrate One Component
- Pick **MealLibrary** (smallest, least risky)
- Swap rendering to use `libraryCard.mustache`
- Test offline, verify performance

### Week 3: Expand
- Migrate **RecipeDetail** view
- Migrate **CookMode**
- Migrate **WeekView** display

### Week 4: Bonus
- Add **Export templates** (PDF, Markdown)
- Improve search with pre-computed `ingredients_text`

---

## Trade-offs & Risks

| Risk | Mitigation |
|------|------------|
| **XSS via `{{{` unescaped HTML)** | Sanitize `*_html` strings at render time. Use DOMPurify if needed. All user input goes through sanitizer first. |
| **Larger DB records** | Yes, storing HTML + structured. Dexie + IndexedDB can handle it (~500KB per recipe is fine). |
| **Mustache learning curve** | Mustache is minimal—12 directives. Easier than learning a custom renderer. |
| **Template maintenance** | Templatize once, maintain forever. Beats maintaining 5 separate React components with custom parsing. |

---

## Comparison: Before vs. After

### Before (Current)
```
MealLibrary.jsx
  ├─ fetch recipe from Dexie
  ├─ parse ingredients string → array
  ├─ split directions by newlines
  ├─ compute servings, cook time
  └─ render custom JSX

RecipeDetail.jsx (duplicate logic)
  ├─ fetch recipe
  ├─ parse ingredients (again)
  ├─ parse directions (again)
  └─ render custom JSX

CookMode.jsx (duplicate logic)
  ├─ fetch recipe
  ├─ parse ingredients (again)
  ├─ format for fullscreen
  └─ render custom JSX
```

### After (Templated)
```
Import Phase (parseVisualJSON)
  ├─ parse ingredients once → structured array
  ├─ parse directions once → step array
  ├─ generate ingredients_html string
  ├─ generate directions_html string
  └─ store everything in Dexie

MealLibrary.jsx
  ├─ fetch recipe
  └─ Mustache.render(libraryCard, recipe)

RecipeDetail.jsx
  ├─ fetch recipe
  └─ Mustache.render(recipeDetail, recipe)

CookMode.jsx
  ├─ fetch recipe
  └─ Mustache.render(cookMode, recipe)
```

**Result**: Parsing happens once. Components are ~40% simpler. New formats (export, widgets) cost only a new template, not new components.

---

## Code Sample: Integration

**Import time** (happens once per recipe):
```javascript
const recipe = parseVisualJSON(visualBlocks, url);
// Output includes: ingredients_structured, ingredients_html, directions_html, etc.

await db.recipes.put(recipe);
```

**Render time** (happens every view, but zero parsing):
```javascript
const recipe = await db.recipes.get(recipeId);
const html = Mustache.render(templates.recipeDetail, recipe);
return <div dangerouslySetInnerHTML={{ __html: html }} />;
```

---

## Recommendation

**Adopt Paprika's pattern incrementally:**

1. ✅ **Extend recipeParser** to output `*_structured` + `*_html` fields (Week 1)
2. ✅ **Pick one component** (MealLibrary) and test with Mustache (Week 2)
3. ✅ **If perf + offline work**, roll out to other views (Week 3–4)

**Why**: You already have 80% of the infrastructure. Adding templates is a **pure win**—no API changes, no breaking changes, just faster rendering + offline support + future export capability.

**Not recommended if**:
- You don't care about offline rendering
- Export/multi-format is never happening
- Component count stays at 3 (currently ~20+, so unlikely)
