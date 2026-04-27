# Sonnet Implementation Prompt: Paprika Templating + Gemini Hybrid Fallback

**Status**: Phase 1 Gemini hybrid parser is DONE. This prompt covers Phase 2-5 of Gemini integration + full Paprika templating rollout.

**Timeline**: 2-3 focused sessions for complete implementation.

---

## Context

Two major architectural improvements are ready for integration:

1. **Paprika Templating** (PAPRIKA_TEMPLATING_ANALYSIS.md) — Parse recipes once at import time, render them in 5+ different formats via Mustache templates. Reduces ImportModal complexity by 40%, enables offline rendering, supports future multi-format export (PDF, Markdown).

2. **Gemini Hybrid Fallback** (GEMINI_HYBRID_IMPLEMENTATION.md) — Visual parser first (fast, free), Gemini as intelligent fallback (only on ambiguous layouts). Phase 1 (core functions) is merged; Phases 2-5 (integration across UI + offline) remain.

---

## Implementation Order

### Phase A: Complete Gemini Hybrid Integration (Phases 2-5)
**Est. 3-4 hours**

#### Phase 2: Wire into ImportModal
- **File**: `src/components/ImportModal.jsx`
- **What**: Show hybrid confidence % + source indicator during import
- **Code changes**:
  ```javascript
  // When import completes, display:
  {currentRecipe?._hybridUsed && (
    <div className="confidence-badge">
      ✦ Enhanced with Gemini • {Math.round(currentRecipe._hybridConfidence * 100)}%
    </div>
  )}
  {!currentRecipe?._hybridUsed && (
    <div className="confidence-badge">
      ⚡ Visual Only • {Math.round(currentRecipe._hybridConfidence * 100)}%
    </div>
  )}
  ```
- **Testing**: Import 5 ambiguous URLs (video overlay, heavy JS site), verify Gemini badge appears + confidence score

#### Phase 3: Update BrowserAssist Status Bar
- **File**: `src/components/BrowserAssist.jsx`
- **What**: Show live status as import runs
- **Code changes**:
  ```javascript
  // In status bar:
  {data?._hybridUsed && <span className="text-amber-400">✦ Gemini hybrid active</span>}
  {!data?._hybridUsed && data && <span className="text-green-400">⚡ Visual parse</span>}
  ```
- **Testing**: Monitor status updates during import, verify phase transitions (visual → gemini → deep)

#### Phase 4: Handle Offline Queue Re-Processing
- **File**: `src/backgroundSync.js`
- **What**: Store visualData in queue; re-process with Gemini when online
- **Code changes**:
  ```javascript
  // When queuing offline import:
  {
    visualData: input.visualNodes,  // Store for re-processing
    caption: input.caption,
    url: input.url,
    _queuedAt: Date.now(),
    _needsGemini: true  // Flag for re-processing
  }
  
  // When syncing online:
  // If _needsGemini && confidence < 0.75, call parseRecipeHybrid() again
  ```
- **Testing**: Queue import offline, verify Gemini re-processing when online

#### Phase 5: Server Route Integration
- **File**: `server/importRoutes.js`
- **What**: Add Gemini fallback to `/api/import/visual-parse` endpoint
- **Code changes**:
  ```javascript
  // In /api/import/visual-parse:
  const { visualData, caption, url } = req.body;
  const recipe = await parseRecipeHybrid(visualData, caption, url);
  res.json({
    ok: true,
    recipe,
    hybridUsed: recipe._hybridUsed,
    confidence: recipe._hybridConfidence
  });
  ```
- **Testing**: Test endpoint with low-confidence visual input, verify Gemini enhancement

---

### Phase B: Implement Paprika Templating (4 phases)
**Est. 5-6 hours**

#### Phase 1: Extend recipeParser
- **File**: `src/recipeParser.js`
- **What**: Add structured fields + pre-rendered HTML to recipe objects
- **Code changes** (add to `parseVisualJSON()` return):
  ```javascript
  ingredients_structured: [
    { quantity: "2", unit: "cups", item: "all-purpose flour" },
    // ...
  ],
  directions_structured: [
    { step: 1, text: "Preheat oven to 375°F" },
    // ...
  ],
  ingredients_html: renderIngredientsHTML(ingredients_structured),
  directions_html: renderDirectionsHTML(directions_structured),
  ingredients_text: 'flour baking soda chocolate chips ...',  // For search
  directions_text: 'Preheat oven Mix dry ingredients ...',  // For search
  ```
- **Helper functions**:
  ```javascript
  function renderIngredientsHTML(ingredients) {
    return `<ul>${ingredients.map(ing => 
      `<li><span class="qty">${ing.quantity} ${ing.unit}</span> ${ing.item}</li>`
    ).join('')}</ul>`;
  }
  ```
- **Testing**: Parse a recipe, verify structured fields + pre-rendered HTML present

#### Phase 2: Extend Dexie Schema
- **File**: `src/db.js`
- **What**: Update recipe model to store structured + cached HTML
- **Code changes**:
  ```javascript
  const recipeSchema = {
    keyPath: 'id',
    indexes: [
      { name: 'name', keyPath: 'name' },
      { name: 'ingredients_text', keyPath: 'ingredients_text' },  // NEW: for search
    ]
  };
  
  // Recipe model now includes:
  // ingredients_structured, directions_structured, ingredients_html, 
  // directions_html, ingredients_text, directions_text
  ```
- **Testing**: Save a recipe, verify all new fields persisted in IndexedDB

#### Phase 3: Create Mustache Templates
- **Files**: `src/templates/` (new directory)
- **Templates to create**:
  1. `libraryCard.mustache` — Compact card for MealLibrary
  2. `recipeDetail.mustache` — Full recipe view
  3. `cookMode.mustache` — Fullscreen cooking mode
  4. `weekCell.mustache` — Week view cell
  5. `recipeExport.mustache` — Print/PDF export (future)

- **Example libraryCard.mustache**:
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

- **Testing**: Verify template syntax, render with sample recipe data

#### Phase 4: Migrate Components to Template Rendering
- **Files**:
  - `src/components/MealLibrary.jsx` → use `libraryCard.mustache`
  - `src/components/RecipeDetail.jsx` → use `recipeDetail.mustache`
  - `src/components/CookMode.jsx` → use `cookMode.mustache`
  - `src/components/WeekView.jsx` → use `weekCell.mustache`

- **Migration pattern**:
  ```javascript
  import Mustache from 'mustache';
  import libraryCardTemplate from '../templates/libraryCard.mustache?raw';
  
  function MealLibraryItem({ recipe }) {
    const html = Mustache.render(libraryCardTemplate, recipe);
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }
  ```

- **Critical**: Remove duplicate parsing logic from each component. Templates do the rendering; components just fetch + inject.

- **Testing**:
  - Migrate one component (MealLibrary) first
  - Test offline mode (templates + cached HTML = no server calls)
  - Verify search still works (using pre-computed ingredients_text)
  - Check performance improvement (render time comparison)

---

## Implementation Strategy

### 1. Start with Gemini Phases 2-5 (Foundation)
- Smaller scope, no UI refactoring
- Gets confidence feedback into the UI quickly
- Validates Gemini integration end-to-end
- **Commit**: "feat(import): complete Gemini hybrid fallback (phases 2-5)"

### 2. Then Paprika Templating (Architecture)
- Start with Phase 1 (recipeParser extension)
- Move to Dexie schema (Phase 2)
- Create templates (Phase 3)
- Migrate components ONE AT A TIME (Phase 4)
- Each component migration = separate commit

### 3. Testing & Validation
- **Unit tests**: 
  - `calculateVisualConfidence()` with various inputs
  - `renderIngredientsHTML()` escaping, formatting
  - Mustache template rendering with sample data
  
- **E2E tests**:
  - Import Instagram post → verify Gemini badge
  - Offline queue → re-process when online
  - MealLibrary render performance before/after templating
  - Search still works with pre-computed text

### 4. Commit Messages

```bash
# Gemini phases 2-5
git commit -m "feat(import): wire Gemini hybrid to UI (phases 2-5)

- Phase 2: Show hybrid confidence % + source in ImportModal
- Phase 3: Add status indicator to BrowserAssist
- Phase 4: Queue visualData for offline re-processing
- Phase 5: Integrate into /api/import/visual-parse endpoint
- Cost tracking: monitor % using Gemini per session

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"

# Paprika templating
git commit -m "feat(templates): extend recipeParser with structured fields

- Add ingredients_structured, directions_structured
- Add ingredients_html, directions_html (pre-rendered)
- Add ingredients_text, directions_text (searchable)
- Enables Paprika-style parse-once-render-many pattern

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"

git commit -m "feat(db): update recipe schema for template rendering

- Add indexes on ingredients_text for search
- Store pre-rendered HTML alongside structured data
- Dexie now caches all render formats

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"

git commit -m "feat(templates): create Mustache templates for all views

- Add libraryCard, recipeDetail, cookMode, weekCell, export templates
- Use {{}} for escaped content, {{{}}}} for pre-rendered HTML
- Ready for component migration

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"

git commit -m "refactor(components): migrate MealLibrary to template rendering

- Remove duplicate ingredient parsing logic
- Use Mustache.render(template, recipe)
- 40% simpler component, offline-friendly, zero API calls on view

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## Success Criteria

- ✅ Gemini phases 2-5 complete: Confidence feedback appears in UI, offline re-processing works
- ✅ Paprika templating foundation: recipeParser outputs structured + HTML, Dexie stores it
- ✅ Templates created: All 5 templates render correctly with sample data
- ✅ First component migrated: MealLibrary uses templates, no parsing logic
- ✅ Tests pass: Unit tests for confidence, HTML rendering, template syntax
- ✅ Performance verified: Offline view time < 500ms (template injection only)
- ✅ Search works: Pre-computed ingredients_text enables fast full-text search in Dexie

---

## Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **XSS via `{{{` HTML)** | Sanitize `*_html` strings at render time. Use DOMPurify if needed. |
| **Larger DB records** | Storing HTML + structured data = ~5-10KB per recipe. IndexedDB can handle 500KB+ easily. |
| **Mustache learning curve** | Minimal—12 directives. Team comfortable with Handlebars/Jinja. |
| **Gemini API quota** | Monitor cost; only called on 20-30% of imports. Budget ~$3/10k imports. |
| **Offline re-processing failure** | Queue stores both structured result + visual data; can fall back to cached version. |

---

## Files to Reference

- **PAPRIKA_TEMPLATING_ANALYSIS.md** — Architecture overview + detailed migration path
- **GEMINI_HYBRID_IMPLEMENTATION.md** — Phase breakdown, code examples, cost analysis
- **src/recipeParser.js** — Already has Phase 1 Gemini functions; extend from there
- **CLAUDE.md** — Project constitution, conventions, deployment targets

---

## Ready for Sonnet?

This prompt is structured so Sonnet can:
1. Read the two analysis documents
2. Implement phases in logical order (Gemini → Templating)
3. Migrate one component at a time (proven pattern)
4. Test incrementally
5. Commit with conventional messages

**Estimated total time**: 8-10 hours of focused work across 2-3 sessions.

**Success looks like**: ImportModal shows confidence % + Gemini badge. MealLibrary renders via Mustache. Offline preview loads in <500ms. Tests pass.
