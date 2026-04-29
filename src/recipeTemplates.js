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
};

/**
 * renderRecipe — convenience wrapper. Pass a recipe + a template name from
 * TEMPLATES and get the rendered string back. Falls back to plain if the
 * named template doesn't exist so callers never crash on a typo.
 */
export function renderRecipe(recipe, templateName = 'markdown') {
  const tpl = TEMPLATES[templateName] || TEMPLATES.plain;
  return renderTemplate(tpl, recipe || {});
}
