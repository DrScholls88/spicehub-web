// src/recipeTemplates.js
//
// Mustache-style recipe templating for print, export, and share-card flows.
// Intentionally additive — nothing in the import path imports from here yet,
// but MealDetail / GroceryList / future "Export as PDF" can pull from this
// without re-implementing field interpolation.
//
// Why a tiny inline renderer instead of `mustache` from npm?
//   - Avoids one more dependency.
//   - Recipe templating only needs three constructs: {{var}}, {{#section}}…{{/section}},
//     and {{^section}}…{{/section}} (inverted). That's ~40 lines of JS.
//   - HTML escaping is opt-out via `{{{var}}}` for fields like rich-text notes.
//
// Public API:
//   renderTemplate(template, context)  → string
//   renderRecipe(recipe, templateName) → string  (uses TEMPLATES below)
//   TEMPLATES                          → { markdown, plain, shareCard }
//
// Adding a template is just adding another entry to TEMPLATES. No JSX, no
// React — these are plain string templates so they work in worker threads,
// service workers, and Node-side render paths alike.

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

function lookup(context, key) {
  if (key === '.') return context;
  // Support dotted paths like recipe.author.name without going wild.
  const parts = key.split('.');
  let cur = context;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isTruthyForSection(value) {
  if (value == null || value === false || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * safeUrl — validates a URL is http(s)/data before letting it flow into a raw
 * (`{{{var}}}`) template slot like `src="{{{imageUrl}}}"` or `href="{{{...}}}"`.
 * Recipe imageUrl/sourceUrl originate from the import pipeline (arbitrary web
 * pages, Instagram captions, video metadata) and are NOT safe to trust as-is —
 * without this, a crafted `imageUrl` like `x" onerror="alert(1)` would break
 * out of the attribute. Escaping `&` would break legitimate query strings, so
 * this validates the scheme and neutralizes quote characters instead of doing
 * a blanket HTML-escape.
 */
export function safeUrl(u) {
  if (!u) return '';
  try {
    const parsed = new URL(String(u), 'https://placeholder.invalid');
    if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) return '';
    return String(u).replace(/"/g, '%22').replace(/'/g, '%27');
  } catch {
    return '';
  }
}

/**
 * renderTemplate — minimal Mustache-compatible renderer.
 *
 * Supports:
 *   {{name}}            HTML-escaped interpolation
 *   {{{name}}}          raw interpolation (no HTML escape)
 *   {{#list}}…{{/list}} section: iterates arrays, expands once for truthy
 *                       non-arrays (with `.` referring to the value)
 *   {{^list}}…{{/list}} inverted section: rendered when value is falsy/empty
 *   {{! comment }}      ignored
 *
 * @param {string} template
 * @param {object} context
 * @returns {string}
 */
export function renderTemplate(template, context) {
  if (!template) return '';
  if (context == null) context = {};

  // Strip comments first — they shouldn't survive into output.
  let src = template.replace(/\{\{!.*?\}\}/gs, '');

  // Handle sections (greedy across lines, allow nesting via recursion).
  const SECTION_RE = /\{\{([#^])([\w.-]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
  let prev;
  do {
    prev = src;
    src = src.replace(SECTION_RE, (_, kind, name, body) => {
      const val = lookup(context, name);
      const truthy = isTruthyForSection(val);
      if (kind === '^') return truthy ? '' : renderTemplate(body, context);
      // kind === '#'
      if (!truthy) return '';
      if (Array.isArray(val)) {
        return val.map((item) => {
          // If items are primitives, expose them as `.`
          const ctx = (typeof item === 'object' && item !== null) ? { ...context, ...item, '.': item } : { ...context, '.': item };
          return renderTemplate(body, ctx);
        }).join('');
      }
      // Truthy non-array — expand once with the value as `.`
      const ctx = (typeof val === 'object' && val !== null) ? { ...context, ...val, '.': val } : { ...context, '.': val };
      return renderTemplate(body, ctx);
    });
  } while (src !== prev);

  // Triple-stache (raw) before double-stache so {{{x}}} isn't half-eaten.
  src = src.replace(/\{\{\{([\w.-]+)\}\}\}/g, (_, name) => {
    const v = lookup(context, name);
    return v == null ? '' : String(v);
  });

  // Double-stache (escaped).
  src = src.replace(/\{\{([\w.-]+)\}\}/g, (_, name) => {
    const v = lookup(context, name);
    return escapeHtml(v == null ? '' : String(v));
  });

  return src;
}

/**
 * Default templates. Each one is a plain string; `renderRecipe` picks one
 * by name and runs it through `renderTemplate` with the recipe object as
 * context. Recipes are expected to expose: name, imageUrl, ingredients[],
 * directions[], notes, prepTime, cookTime, servings, sourceUrl.
 */
export const TEMPLATES = {
  markdown: [
    '# {{name}}',
    '',
    '{{#imageUrl}}![{{name}}]({{{imageUrl}}}){{/imageUrl}}',
    '',
    '{{#prepTime}}**Prep:** {{prepTime}}  {{/prepTime}}{{#cookTime}}**Cook:** {{cookTime}}  {{/cookTime}}{{#servings}}**Serves:** {{servings}}{{/servings}}',
    '',
    '## Ingredients',
    '',
    '{{#ingredients}}- {{.}}\n{{/ingredients}}',
    '',
    '## Directions',
    '',
    '{{#directions}}1. {{.}}\n{{/directions}}',
    '',
    '{{#notes}}## Notes\n\n{{notes}}\n\n{{/notes}}',
    '{{#sourceUrl}}_Source: {{sourceUrl}}_{{/sourceUrl}}',
    '',
  ].join('\n'),

  plain: [
    '{{name}}',
    '{{#sourceUrl}}({{sourceUrl}}){{/sourceUrl}}',
    '',
    '{{#prepTime}}Prep: {{prepTime}}  {{/prepTime}}{{#cookTime}}Cook: {{cookTime}}  {{/cookTime}}{{#servings}}Serves: {{servings}}{{/servings}}',
    '',
    'INGREDIENTS',
    '{{#ingredients}}  - {{.}}\n{{/ingredients}}',
    '',
    'DIRECTIONS',
    '{{#directions}}  - {{.}}\n{{/directions}}',
    '',
    '{{#notes}}NOTES\n  {{notes}}\n{{/notes}}',
  ].join('\n'),

  shareCard: [
    '<article class="recipe-card">',
    '  <h1>{{name}}</h1>',
    '  {{#imageUrl}}<img src="{{{imageUrl}}}" alt="{{name}}" />{{/imageUrl}}',
    '  <ul class="ingredients">',
    '    {{#ingredients}}<li>{{.}}</li>{{/ingredients}}',
    '  </ul>',
    '  <ol class="directions">',
    '    {{#directions}}<li>{{.}}</li>{{/directions}}',
    '  </ol>',
    '  {{#notes}}<p class="notes">{{notes}}</p>{{/notes}}',
    '  {{#sourceUrl}}<p class="source"><a href="{{{sourceUrl}}}">Source</a></p>{{/sourceUrl}}',
    '</article>',
  ].join('\n'),

  // ── Drink / cocktail card — renders glass, method, garnish fields ──────────
  drinkCard: [
    '<article class="recipe-card recipe-card--drink">',
    '  <h1>{{name}}</h1>',
    '  {{#imageUrl}}<img src="{{{imageUrl}}}" alt="{{name}}" />{{/imageUrl}}',
    '  <div class="drink-meta">',
    '    {{#glass}}<span class="drink-meta-item"><strong>Glass:</strong> {{glass}}</span>{{/glass}}',
    '    {{#method}}<span class="drink-meta-item"><strong>Method:</strong> {{method}}</span>{{/method}}',
    '    {{#servings}}<span class="drink-meta-item"><strong>Serves:</strong> {{servings}}</span>{{/servings}}',
    '  </div>',
    '  <ul class="ingredients">',
    '    {{#ingredients}}<li>{{.}}</li>{{/ingredients}}',
    '  </ul>',
    '  <ol class="directions">',
    '    {{#directions}}<li>{{.}}</li>{{/directions}}',
    '  </ol>',
    '  {{#garnish}}<p class="drink-garnish"><strong>Garnish:</strong> {{garnish}}</p>{{/garnish}}',
    '  {{#notes}}<p class="notes">{{notes}}</p>{{/notes}}',
    '  {{#sourceUrl}}<p class="source"><a href="{{{sourceUrl}}}">Source</a></p>{{/sourceUrl}}',
    '</article>',
  ].join('\n'),

  // ── Schema.org JSON-LD — for SEO export or PWA rich-result sharing ─────────
  // NOTE: This template produces a JSON string, not HTML.
  // The caller is responsible for wrapping it in <script type="application/ld+json">.
  // recipeIngredient and recipeInstructions must be pre-formatted arrays in the
  // recipe context, or this template uses the ingredients/directions string arrays.
  schemaOrg: [
    '{',
    '  "@context": "https://schema.org",',
    '  "@type": "Recipe",',
    '  "name": "{{name}}",',
    '  {{#imageUrl}}"image": "{{{imageUrl}}}",{{/imageUrl}}',
    '  {{#description}}"description": "{{description}}",{{/description}}',
    '  {{#servings}}"recipeYield": "{{servings}}",{{/servings}}',
    '  {{#prepTime}}"prepTime": "{{prepTime}}",{{/prepTime}}',
    '  {{#cookTime}}"cookTime": "{{cookTime}}",{{/cookTime}}',
    '  {{#totalTime}}"totalTime": "{{totalTime}}",{{/totalTime}}',
    '  {{#cuisine}}"recipeCuisine": "{{cuisine}}",{{/cuisine}}',
    '  "recipeIngredient": [{{#ingredients}}"{{.}}"{{/ingredients}}],',
    '  "recipeInstructions": [',
    '    {{#directions}}{"@type": "HowToStep", "text": "{{.}}"}{{/directions}}',
    '  ]{{#sourceUrl}},',
    '  "url": "{{{sourceUrl}}}"{{/sourceUrl}}',
    '}',
  ].join('\n'),

  // ── Grocery list (HTML) — styled with category sections and checkboxes ──────
  groceryHtml: [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>{{title}}</title>',
    '<style>',
    '  *{box-sizing:border-box;margin:0;padding:0}',
    '  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '       max-width:600px;margin:2rem auto;padding:0 1rem;color:#2d2d2d;background:#fafaf8}',
    '  h1{font-size:1.6rem;font-weight:700;color:#1a1a1a;margin-bottom:1.5rem;',
    '     padding-bottom:.75rem;border-bottom:2px solid #C4841D}',
    '  .grocery-section{margin-bottom:1.75rem}',
    '  .grocery-section-header{font-size:.85rem;font-weight:600;text-transform:uppercase;',
    '     letter-spacing:.08em;color:#fff;background:#C4841D;padding:.4rem .75rem;',
    '     border-radius:6px;margin-bottom:.5rem}',
    '  .grocery-item{display:flex;align-items:center;gap:.75rem;padding:.6rem .5rem;',
    '     border-bottom:1px solid #eee;transition:background .15s}',
    '  .grocery-item:last-child{border-bottom:none}',
    '  .grocery-item:hover{background:#f5f0e8}',
    '  .grocery-checkbox{appearance:none;-webkit-appearance:none;width:22px;height:22px;',
    '     border:2px solid #C4841D;border-radius:5px;cursor:pointer;flex-shrink:0;',
    '     display:inline-flex;align-items:center;justify-content:center;transition:all .15s}',
    '  .grocery-checkbox:checked{background:#C4841D;border-color:#C4841D}',
    '  .grocery-checkbox:checked::after{content:"\\2713";color:#fff;font-size:14px;font-weight:700}',
    '  .grocery-item-name{font-size:1rem;line-height:1.4}',
    '  .grocery-item--purchased .grocery-item-name{text-decoration:line-through;color:#999}',
    '  @media print{',
    '    body{margin:0;background:#fff}',
    '    .grocery-checkbox{print-color-adjust:exact;-webkit-print-color-adjust:exact}',
    '  }',
    '</style></head><body>',
    '<h1>{{title}}</h1>',
    '{{#items}}',
    '{{#is_section}}',
    '<div class="grocery-section">',
    '  <div class="grocery-section-header">{{name}}</div>',
    '</div>',
    '{{/is_section}}',
    '{{^is_section}}',
    '<div class="grocery-item{{#purchased}} grocery-item--purchased{{/purchased}}">',
    '  <input type="checkbox" class="grocery-checkbox"{{#purchased}} checked{{/purchased}} />',
    '  <span class="grocery-item-name">{{name}}</span>',
    '</div>',
    '{{/is_section}}',
    '{{/items}}',
    '</body></html>',
  ].join('\n'),

  // ── Grocery list (plain text) — ☐/☒ checkboxes grouped by section headers ──
  groceryText: [
    '{{title}}',
    '{{#items}}',
    '{{#is_section}}',
    '',
    '── {{name}} ──',
    '{{/is_section}}',
    '{{^is_section}}',
    '{{#purchased}}  ☒ {{name}}{{/purchased}}',
    '{{^purchased}}  ☐ {{name}}{{/purchased}}',
    '{{/is_section}}',
    '{{/items}}',
  ].join('\n'),

  // ── Meal plan (HTML) — styled day cards with meal-type badges ──────────────
  mealPlanHtml: [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>{{title}}</title>',
    '<style>',
    '  *{box-sizing:border-box;margin:0;padding:0}',
    '  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '       max-width:700px;margin:2rem auto;padding:0 1rem;color:#2d2d2d;background:#fafaf8}',
    '  h1{font-size:1.6rem;font-weight:700;color:#1a1a1a;margin-bottom:1.5rem;',
    '     padding-bottom:.75rem;border-bottom:2px solid #C4841D}',
    '  .day-card{background:#fff;border:1px solid #e8e4dc;border-radius:10px;',
    '     padding:1.25rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
    '  .day-date{font-size:1.1rem;font-weight:700;color:#C4841D;margin-bottom:.75rem;',
    '     padding-bottom:.5rem;border-bottom:1px solid #f0ece4}',
    '  .meal-row{display:flex;align-items:baseline;gap:.75rem;padding:.35rem 0}',
    '  .meal-type-badge{display:inline-block;font-size:.7rem;font-weight:600;',
    '     text-transform:uppercase;letter-spacing:.06em;color:#fff;background:#C4841D;',
    '     padding:.2rem .5rem;border-radius:4px;min-width:60px;text-align:center;flex-shrink:0}',
    '  .meal-type-badge--breakfast{background:#e88c30}',
    '  .meal-type-badge--lunch{background:#5a9e6f}',
    '  .meal-type-badge--dinner{background:#c0392b}',
    '  .meal-type-badge--snack{background:#8e7cc3}',
    '  .meal-recipes{font-size:.95rem;line-height:1.5;color:#333}',
    '  @media print{',
    '    body{margin:0;background:#fff}',
    '    .day-card{box-shadow:none;break-inside:avoid}',
    '  }',
    '</style></head><body>',
    '<h1>{{title}}</h1>',
    '{{#days}}',
    '<div class="day-card">',
    '  <div class="day-date">{{date}}</div>',
    '  {{#meal_types}}',
    '  <div class="meal-row">',
    '    <span class="meal-type-badge meal-type-badge--{{type}}">{{type}}</span>',
    '    <span class="meal-recipes">{{recipes}}</span>',
    '  </div>',
    '  {{/meal_types}}',
    '</div>',
    '{{/days}}',
    '</body></html>',
  ].join('\n'),

  // ── Meal plan (plain text) ────────────────────────────────────────────────────
  mealPlanText: [
    '{{title}}',
    '========',
    '',
    '{{#days}}',
    '{{date}}:',
    '{{#meal_types}}',
    '  {{type}}: {{recipes}}',
    '{{/meal_types}}',
    '',
    '{{/days}}',
  ].join('\n'),

  // ── Enhanced print — two-column layout with Schema.org microdata ───────────
  enhancedPrint: [
    '<!DOCTYPE html>',
    '<html lang="en" itemscope itemtype="https://schema.org/Recipe">',
    '<head><meta charset="UTF-8"><title>{{name}}</title>',
    '<style>',
    '  *{box-sizing:border-box;margin:0;padding:0}',
    '  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '       max-width:800px;margin:0 auto;padding:2rem 1.5rem;color:#2d2d2d;background:#fff}',
    '  .recipe-header{margin-bottom:1.5rem}',
    '  h1{font-size:2rem;font-weight:800;color:#1a1a1a;line-height:1.2;margin-bottom:.5rem}',
    '  .recipe-description{font-size:.95rem;color:#555;line-height:1.5;margin-bottom:1rem;font-style:italic}',
    '  .recipe-meta{display:flex;flex-wrap:wrap;gap:1rem;padding:.75rem 0;border-top:2px solid #C4841D;',
    '     border-bottom:1px solid #e8e4dc;margin-bottom:1.5rem}',
    '  .meta-item{font-size:.85rem;color:#555}',
    '  .meta-item strong{color:#C4841D;font-weight:700}',
    '  .recipe-image{width:100%;max-height:400px;object-fit:cover;border-radius:8px;margin-bottom:1.5rem}',
    '  .recipe-categories{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem}',
    '  .recipe-category-tag{font-size:.75rem;background:#f5f0e8;color:#8b6914;padding:.2rem .6rem;',
    '     border-radius:12px;font-weight:500}',
    '  .recipe-rating{color:#C4841D;font-size:1.1rem;margin-bottom:1rem}',
    '  .recipe-columns{display:grid;grid-template-columns:1fr 1.4fr;gap:2rem}',
    '  .recipe-col-heading{font-size:1rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;',
    '     color:#C4841D;border-bottom:2px solid #C4841D;padding-bottom:.4rem;margin-bottom:.75rem}',
    '  .recipe-ingredients{list-style:none;padding:0}',
    '  .recipe-ingredients li{padding:.4rem 0;border-bottom:1px solid #f0ece4;font-size:.9rem;line-height:1.5}',
    '  .recipe-ingredients li:last-child{border-bottom:none}',
    '  .recipe-directions{list-style:none;padding:0;counter-reset:step}',
    '  .recipe-directions li{padding:.5rem 0 .5rem 2.5rem;border-bottom:1px solid #f0ece4;',
    '     font-size:.9rem;line-height:1.6;position:relative}',
    '  .recipe-directions li:last-child{border-bottom:none}',
    '  .recipe-directions li::before{counter-increment:step;content:counter(step);',
    '     position:absolute;left:0;top:.5rem;width:1.8rem;height:1.8rem;background:#C4841D;',
    '     color:#fff;font-size:.8rem;font-weight:700;border-radius:50%;display:flex;',
    '     align-items:center;justify-content:center}',
    '  .recipe-notes{background:#fffdf5;border-left:3px solid #C4841D;padding:.75rem 1rem;',
    '     border-radius:0 6px 6px 0;margin-top:1.5rem;font-size:.9rem;line-height:1.6;font-style:italic}',
    '  .recipe-notes-heading{font-size:.85rem;font-weight:700;text-transform:uppercase;',
    '     letter-spacing:.06em;color:#C4841D;margin-bottom:.35rem}',
    '  .recipe-source{font-size:.8rem;color:#888;margin-top:1.5rem;padding-top:.75rem;border-top:1px solid #e8e4dc}',
    '  @media print{',
    '    body{margin:0;padding:1rem}',
    '    .recipe-image{max-height:250px}',
    '    .recipe-columns{grid-template-columns:1fr 1.4fr;gap:1.5rem}',
    '    .recipe-notes{break-inside:avoid}',
    '  }',
    '  @media (max-width:600px){',
    '    .recipe-columns{grid-template-columns:1fr}',
    '  }',
    '</style></head><body>',
    '<div class="recipe-header">',
    '  <h1 itemprop="name">{{name}}</h1>',
    '  {{#description}}<p class="recipe-description" itemprop="description">{{description}}</p>{{/description}}',
    '</div>',
    '<div class="recipe-meta">',
    '  {{#prepTime}}<span class="meta-item"><strong>Prep:</strong> <span itemprop="prepTime">{{prepTime}}</span></span>{{/prepTime}}',
    '  {{#cookTime}}<span class="meta-item"><strong>Cook:</strong> <span itemprop="cookTime">{{cookTime}}</span></span>{{/cookTime}}',
    '  {{#servings}}<span class="meta-item"><strong>Serves:</strong> <span itemprop="recipeYield">{{servings}}</span></span>{{/servings}}',
    '</div>',
    '{{#imageUrl}}<img class="recipe-image" src="{{{imageUrl}}}" alt="{{name}}" itemprop="image" />{{/imageUrl}}',
    '{{#rating_stars}}<div class="recipe-rating" itemprop="aggregateRating">{{rating_stars}}</div>{{/rating_stars}}',
    '{{#categories}}',
    '<div class="recipe-categories">',
    '  {{#categories}}<span class="recipe-category-tag">{{.}}</span>{{/categories}}',
    '</div>',
    '{{/categories}}',
    '<div class="recipe-columns">',
    '  <div>',
    '    <div class="recipe-col-heading">Ingredients</div>',
    '    <ul class="recipe-ingredients">',
    '      {{#ingredients}}<li itemprop="recipeIngredient">{{.}}</li>{{/ingredients}}',
    '    </ul>',
    '  </div>',
    '  <div>',
    '    <div class="recipe-col-heading">Directions</div>',
    '    <ol class="recipe-directions">',
    '      {{#directions}}<li itemprop="recipeInstructions">{{.}}</li>{{/directions}}',
    '    </ol>',
    '  </div>',
    '</div>',
    '{{#notes}}',
    '<div class="recipe-notes">',
    '  <div class="recipe-notes-heading">Notes</div>',
    '  <p>{{notes}}</p>',
    '</div>',
    '{{/notes}}',
    '{{#sourceUrl}}<p class="recipe-source">Source: <a href="{{{sourceUrl}}}" itemprop="url">{{{sourceUrl}}}</a></p>{{/sourceUrl}}',
    '</body></html>',
  ].join('\n'),

  // ── Index card — 4x6 physical print layout, one recipe per card ───────────
  indexCard: [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>{{name}} — Index Card</title>',
    '<style>',
    '  @page{size:6in 4in;margin:.25in}',
    '  *{box-sizing:border-box;margin:0;padding:0}',
    '  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '       font-size:9pt;color:#222;background:#fff}',
    '  .index-card{width:5.5in;height:3.5in;border:1px dashed #bbb;border-radius:4px;',
    '     padding:.2in .25in;overflow:hidden;page-break-after:always;position:relative}',
    '  .card-title{font-size:12pt;font-weight:800;color:#1a1a1a;border-bottom:2px solid #C4841D;',
    '     padding-bottom:3pt;margin-bottom:4pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '  .card-meta{font-size:7pt;color:#777;margin-bottom:4pt}',
    '  .card-body{display:flex;gap:.15in;height:calc(100% - 36pt)}',
    '  .card-ingredients{width:40%;font-size:8pt;line-height:1.35;border-right:1px solid #e8e4dc;',
    '     padding-right:.1in;overflow:hidden}',
    '  .card-ingredients-heading{font-size:7pt;font-weight:700;text-transform:uppercase;',
    '     letter-spacing:.06em;color:#C4841D;margin-bottom:2pt}',
    '  .card-ingredients ul{list-style:none;padding:0}',
    '  .card-ingredients li{padding:1pt 0}',
    '  .card-directions{width:60%;font-size:8pt;line-height:1.35;overflow:hidden}',
    '  .card-directions-heading{font-size:7pt;font-weight:700;text-transform:uppercase;',
    '     letter-spacing:.06em;color:#C4841D;margin-bottom:2pt}',
    '  .card-directions ol{padding-left:14pt}',
    '  .card-directions li{padding:1pt 0}',
    '  @media print{',
    '    body{background:#fff}',
    '    .index-card{border:1px dashed #ccc}',
    '  }',
    '</style></head><body>',
    '<div class="index-card">',
    '  <div class="card-title">{{name}}</div>',
    '  <div class="card-meta">',
    '    {{#prepTime}}Prep: {{prepTime}} &nbsp;{{/prepTime}}',
    '    {{#cookTime}}Cook: {{cookTime}} &nbsp;{{/cookTime}}',
    '    {{#servings}}Serves: {{servings}}{{/servings}}',
    '  </div>',
    '  <div class="card-body">',
    '    <div class="card-ingredients">',
    '      <div class="card-ingredients-heading">Ingredients</div>',
    '      <ul>{{#ingredients}}<li>{{.}}</li>{{/ingredients}}</ul>',
    '    </div>',
    '    <div class="card-directions">',
    '      <div class="card-directions-heading">Directions</div>',
    '      <ol>{{#directions}}<li>{{.}}</li>{{/directions}}</ol>',
    '    </div>',
    '  </div>',
    '</div>',
    '</body></html>',
  ].join('\n'),

  // ── Print-friendly HTML — inline styles so it works outside any stylesheet ─
  print: [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>{{name}}</title>',
    '<style>',
    '  body{font-family:Georgia,serif;max-width:680px;margin:2rem auto;padding:0 1rem;color:#222}',
    '  h1{font-size:1.8rem;margin-bottom:.25rem}',
    '  .meta{color:#666;font-size:.9rem;margin-bottom:1.5rem}',
    '  img{width:100%;max-height:360px;object-fit:cover;border-radius:8px;margin-bottom:1.5rem}',
    '  h2{font-size:1.1rem;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #ddd;padding-bottom:.3rem;margin:1.5rem 0 .75rem}',
    '  ul,ol{padding-left:1.5rem;line-height:1.8}',
    '  li{margin-bottom:.25rem}',
    '  .notes{background:#fffdf5;border-left:3px solid #e6a817;padding:.75rem 1rem;border-radius:4px;font-style:italic}',
    '  .source{font-size:.8rem;color:#888;margin-top:2rem}',
    '@media print{body{margin:0}img{max-height:240px}}',
    '</style></head><body>',
    '<h1>{{name}}</h1>',
    '<p class="meta">{{#prepTime}}Prep: {{prepTime}} &nbsp;{{/prepTime}}{{#cookTime}}Cook: {{cookTime}} &nbsp;{{/cookTime}}{{#servings}}Serves: {{servings}}{{/servings}}</p>',
    '{{#imageUrl}}<img src="{{{imageUrl}}}" alt="{{name}}" />{{/imageUrl}}',
    '<h2>Ingredients</h2>',
    '<ul>{{#ingredients}}<li>{{.}}</li>{{/ingredients}}</ul>',
    '<h2>Directions</h2>',
    '<ol>{{#directions}}<li>{{.}}</li>{{/directions}}</ol>',
    '{{#notes}}<h2>Notes</h2><p class="notes">{{notes}}</p>{{/notes}}',
    '{{#sourceUrl}}<p class="source">Source: <a href="{{{sourceUrl}}}">{{{sourceUrl}}}</a></p>{{/sourceUrl}}',
    '</body></html>',
  ].join('\n'),
};

/**
 * renderRecipe — convenience wrapper. Pass a recipe + a template name from
 * TEMPLATES and get the rendered string back.
 *
 * Auto-selects drinkCard for drink-type recipes when no explicit template is
 * given, so callers don't need to know the recipe type.
 *
 * Falls back to plain if the named template doesn't exist so callers never
 * crash on a typo.
 */
export function renderRecipe(recipe, templateName = 'markdown') {
  // Auto-select drink template for drink-type recipes using the default template
  const autoName = (templateName === 'markdown' && recipe?._type === 'drink')
    ? 'drinkCard'
    : templateName;
  const tpl = TEMPLATES[autoName] || TEMPLATES.plain;
  const ctx = recipe
    ? { ...recipe, imageUrl: safeUrl(recipe.imageUrl), sourceUrl: safeUrl(recipe.sourceUrl) }
    : {};
  return renderTemplate(tpl, ctx);
}

/**
 * renderSchemaOrg — convenience wrapper that returns a Schema.org JSON-LD
 * string for the given recipe. The caller wraps it in a <script> tag.
 *
 * Note: The schemaOrg template doesn't support the full Mustache section
 * iteration for arrays (it needs comma-separated JSON values). This helper
 * builds the JSON directly for correctness.
 */
export function renderSchemaOrg(recipe) {
  if (!recipe) return '';
  const r = recipe;
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: r.name || '',
    ...(r.imageUrl ? { image: r.imageUrl } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(r.servings ? { recipeYield: r.servings } : {}),
    ...(r.prepTime ? { prepTime: r.prepTime } : {}),
    ...(r.cookTime ? { cookTime: r.cookTime } : {}),
    ...(r.totalTime ? { totalTime: r.totalTime } : {}),
    ...(r.cuisine ? { recipeCuisine: r.cuisine } : {}),
    ...(Array.isArray(r.dietaryTags) && r.dietaryTags.length > 0
      ? { suitableForDiet: r.dietaryTags.join(', ') }
      : {}),
    recipeIngredient: Array.isArray(r.ingredients) ? r.ingredients.filter(Boolean) : [],
    recipeInstructions: Array.isArray(r.directions)
      ? r.directions.filter(Boolean).map((text, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          text,
        }))
      : [],
    ...(r.notes ? { comment: r.notes } : {}),
    ...(r.link ? { url: r.link } : {}),
  };
  return JSON.stringify(obj, null, 2);
}
