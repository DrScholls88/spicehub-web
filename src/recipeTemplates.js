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
    '{{#notes}}<h2>Notes</h2><p class="notes">{{{notes}}}</p>{{/notes}}',
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
  return renderTemplate(tpl, recipe || {});
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
