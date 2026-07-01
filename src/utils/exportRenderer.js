// src/utils/exportRenderer.js
//
// Export rendering utilities that connect recipeTemplates with the ingredient
// normalizer for grocery/meal-plan/recipe export flows. Works offline — no
// external CDN dependencies.
//
// Public API:
//   renderGroceryExport(ingredients, options)  → string
//   renderMealPlanExport(days, options)        → string
//   renderRecipeExport(recipe, options)        → string
//   renderIndexCards(recipes, options)         → string (HTML)
//   exportToClipboard(content, onToast)       → Promise<void>
//   exportViaShare(title, content)            → Promise<void>
//   exportForPrint(htmlContent)               → void

import { renderTemplate, renderRecipe, TEMPLATES, safeUrl } from '../recipeTemplates.js';
import { consolidateGroceries, normalizeIngredient } from './ingredientNormalizer.js';
import { GROCERY_CATEGORIES } from '../recipeSchema.js';
import { formatQuantity, formatUnit, formatFood } from './displayFormatter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a consolidated grocery item as a polished display string using the
 * display formatter for unicode fractions + automatic pluralization.
 * E.g. { canonical: 'onion', totalQuantity: 2, unit: 'cup' } → "2 cups onion"
 *      { canonical: 'tomato', totalQuantity: 3, unit: '' }   → "3 tomatoes"
 */
function formatGroceryItem(item) {
  const qty = item.totalQuantity != null ? item.totalQuantity : '';
  const unit = item.unit || '';
  const food = item.canonical || item.name || '';
  const numQty = typeof qty === 'number' ? qty : parseFloat(qty);

  const fmtQty = formatQuantity(qty, { useFractions: true });
  const fmtUnit = formatUnit(unit, isNaN(numQty) ? 1 : numQty);
  const fmtFood = formatFood(food, isNaN(numQty) ? 1 : numQty, !!unit);

  return [fmtQty, fmtUnit, fmtFood].filter(Boolean).join(' ').trim();
}

/**
 * Group consolidated grocery items by GROCERY_CATEGORIES, returning a flat
 * array of { is_section, name, purchased } items suitable for the grocery
 * templates. Sections that have no items are omitted.
 */
function buildGroceryItems(consolidated, showPurchased) {
  // Build a map of category -> items
  const byCategory = new Map();
  for (const cat of GROCERY_CATEGORIES) {
    byCategory.set(cat, []);
  }

  for (const item of consolidated) {
    const cat = GROCERY_CATEGORIES.includes(item.category) ? item.category : 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }

  const result = [];

  for (const cat of GROCERY_CATEGORIES) {
    const items = byCategory.get(cat) || [];
    if (items.length === 0) continue;

    // Section header
    result.push({ is_section: true, name: cat, purchased: false });

    // Items
    for (const item of items) {
      const purchased = showPurchased ? !!item.purchased : false;
      result.push({
        is_section: false,
        name: formatGroceryItem(item),
        purchased,
      });
    }
  }

  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * renderGroceryExport — render a grocery list from raw ingredient strings.
 *
 * Uses consolidateGroceries from the normalizer for dedup/merge, then groups
 * by GROCERY_CATEGORIES and renders via groceryHtml or groceryText template.
 *
 * @param {Array<string|{quantity:number, unit:string, name:string}>} ingredients
 * @param {object} options
 * @param {'html'|'text'} options.format - Output format (default 'text')
 * @param {string} options.title - List title (default 'Grocery List')
 * @param {boolean} options.showPurchased - Show purchased state (default false)
 * @returns {string}
 */
export function renderGroceryExport(ingredients, options = {}) {
  const {
    format = 'text',
    title = 'Grocery List',
    showPurchased = false,
  } = options;

  // Consolidate via normalizer — handles dedup, unit conversion, canonical names
  const consolidated = consolidateGroceries(ingredients);

  // Build the flat items array for the template
  const items = buildGroceryItems(consolidated, showPurchased);

  const templateName = format === 'html' ? 'groceryHtml' : 'groceryText';
  const tpl = TEMPLATES[templateName];
  if (!tpl) return '';

  return renderTemplate(tpl, { title, items });
}

/**
 * renderMealPlanExport — render a meal plan by day.
 *
 * @param {Array<{date:string, meals:Array<{type:string, recipes:string}>}>} days
 * @param {object} options
 * @param {'html'|'text'} options.format - Output format (default 'text')
 * @param {string} options.title - Plan title (default 'Meal Plan')
 * @returns {string}
 */
export function renderMealPlanExport(days, options = {}) {
  const {
    format = 'text',
    title = 'Meal Plan',
  } = options;

  // Normalize the days structure: callers pass `meals` but templates expect `meal_types`
  const normalizedDays = (days || []).map(day => ({
    date: day.date || '',
    meal_types: (day.meals || day.meal_types || []).map(m => ({
      type: m.type || '',
      recipes: m.recipes || '',
    })),
  }));

  const templateName = format === 'html' ? 'mealPlanHtml' : 'mealPlanText';
  const tpl = TEMPLATES[templateName];
  if (!tpl) return '';

  return renderTemplate(tpl, { title, days: normalizedDays });
}

/**
 * renderRecipeExport — render a single recipe in the specified format.
 *
 * @param {object} recipe - Recipe object with name, ingredients[], directions[], etc.
 * @param {object} options
 * @param {'text'|'html'|'print'|'indexCard'|'markdown'} options.format - Output format (default 'text')
 * @returns {string}
 */
export function renderRecipeExport(recipe, options = {}) {
  const { format = 'text' } = options;

  if (!recipe) return '';

  // Build a context object with all template variables
  const ctx = {
    name: recipe.name || '',
    imageUrl: safeUrl(recipe.imageUrl || recipe.image || ''),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.filter(Boolean) : [],
    directions: Array.isArray(recipe.directions) ? recipe.directions.filter(Boolean) : [],
    // Flatten structured notes [{title, text}] to a single string for templates.
    notes: Array.isArray(recipe.notes)
      ? recipe.notes.map(n => n.title ? `${n.title}: ${n.text}` : n.text).join('\n')
      : (recipe._notesFlat || recipe.notes || ''),
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    servings: recipe.servings || '',
    categories: Array.isArray(recipe.categories) ? recipe.categories.filter(Boolean) : [],
    sourceUrl: safeUrl(recipe.sourceUrl || recipe.link || ''),
    description: recipe.description || '',
    rating_stars: recipe.rating_stars || '',
    // Pass through any extra fields the recipe might have
    glass: recipe.glass || '',
    method: recipe.method || '',
    garnish: recipe.garnish || '',
    _type: recipe._type || '',
  };

  // Map format to template name
  const templateMap = {
    text: 'plain',
    markdown: 'markdown',
    html: 'shareCard',
    print: 'enhancedPrint',
    indexCard: 'indexCard',
  };

  const templateName = templateMap[format] || 'plain';
  const tpl = TEMPLATES[templateName];
  if (!tpl) return renderRecipe(recipe, 'plain');

  return renderTemplate(tpl, ctx);
}

/**
 * renderIndexCards — render multiple recipes as index cards in a single HTML document.
 *
 * @param {Array<object>} recipes - Array of recipe objects
 * @param {object} options - Reserved for future use
 * @returns {string} Complete HTML document with all index cards
 */
export function renderIndexCards(recipes, options = {}) {
  if (!Array.isArray(recipes) || recipes.length === 0) return '';

  const cards = recipes.map(recipe => {
    const ctx = {
      name: recipe.name || '',
      ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.filter(Boolean) : [],
      directions: Array.isArray(recipe.directions) ? recipe.directions.filter(Boolean) : [],
      prepTime: recipe.prepTime || '',
      cookTime: recipe.cookTime || '',
      servings: recipe.servings || '',
    };

    // Render just the card body (strip the HTML wrapper since we combine them)
    const tpl = TEMPLATES.indexCard;
    if (!tpl) return '';
    return renderTemplate(tpl, ctx);
  });

  // Extract the <style> block from the first card's full HTML and build a combined document
  const firstCard = cards[0] || '';
  const styleMatch = firstCard.match(/<style>([\s\S]*?)<\/style>/);
  const styles = styleMatch ? styleMatch[1] : '';

  // Extract just the card divs from each rendered card
  const cardBodies = cards.map(card => {
    const bodyMatch = card.match(/<body>([\s\S]*?)<\/body>/);
    return bodyMatch ? bodyMatch[1].trim() : '';
  }).filter(Boolean);

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="UTF-8"><title>Recipe Index Cards</title>',
    '<style>',
    styles,
    '  .cards-container{display:flex;flex-direction:column;align-items:center;gap:.25in}',
    '</style></head><body>',
    '<div class="cards-container">',
    cardBodies.join('\n'),
    '</div>',
    '</body></html>',
  ].join('\n');
}

/**
 * exportToClipboard — write content to the clipboard and show a toast.
 *
 * @param {string} content - Text to copy
 * @param {function} onToast - Callback to show a toast message (receives a string)
 * @returns {Promise<void>}
 */
export async function exportToClipboard(content, onToast) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      // Fallback for older browsers / insecure contexts
      const textarea = document.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (typeof onToast === 'function') {
      onToast('Copied to clipboard');
    }
  } catch (err) {
    console.error('[exportToClipboard] Failed:', err);
    if (typeof onToast === 'function') {
      onToast('Failed to copy to clipboard');
    }
  }
}

/**
 * exportViaShare — use the Web Share API if available, fall back to clipboard.
 *
 * @param {string} title - Share title
 * @param {string} content - Content to share
 * @returns {Promise<void>}
 */
export async function exportViaShare(title, content) {
  try {
    if (navigator.share) {
      await navigator.share({
        title: title || 'SpiceHub Export',
        text: content,
      });
    } else {
      // Fallback to clipboard
      await exportToClipboard(content, null);
    }
  } catch (err) {
    // User cancelled share or it failed — not necessarily an error
    if (err.name !== 'AbortError') {
      console.error('[exportViaShare] Failed:', err);
    }
  }
}

/**
 * exportForPrint — open a new window with the HTML content and trigger print.
 *
 * @param {string} htmlContent - Complete HTML document string
 */
export function exportForPrint(htmlContent) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    console.error('[exportForPrint] Could not open print window — popup blocker?');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Wait for images/content to load before triggering print
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };

  // Fallback: if onload doesn't fire (some browsers), trigger after a short delay
  setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (_) {
      // Window may have been closed by the user
    }
  }, 500);
}
