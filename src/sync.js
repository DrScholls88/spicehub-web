/**
 * SpiceHub Cloud Sync
 *
 * Two modes:
 *   1. Manual export/import — works immediately, no account needed
 *   2. Firebase sync — automatic cross-device (set up FIREBASE_CONFIG to enable)
 *
 * The manual mode uses JSON files that can be shared via Google Drive, iCloud,
 * OneDrive, email, AirDrop, etc.
 */

import db from './db';

// ── Manual Export/Import ──────────────────────────────────────────────────────

/**
 * Export all meals as a JSON blob (for download or sharing)
 */
export async function exportMeals() {
  const meals = await db.meals.toArray();
  const data = {
    version: 1,
    app: 'SpiceHub',
    exportedAt: new Date().toISOString(),
    meals: meals.map(({ id, ...rest }) => rest), // Strip local IDs
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Download meals as a JSON file
 */
export async function downloadMealsFile() {
  const json = await exportMeals();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spicehub-meals-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import meals from a JSON file (merges — skips duplicates by name)
 * Returns { added, skipped }
 */
export async function importMealsFromJson(jsonString) {
  const data = JSON.parse(jsonString);
  if (!data.meals || !Array.isArray(data.meals)) {
    throw new Error('Invalid SpiceHub backup file');
  }

  const existing = await db.meals.toArray();
  const existingNames = new Set(existing.map(m => m.name.toLowerCase().trim()));

  let added = 0;
  let skipped = 0;
  for (const meal of data.meals) {
    if (existingNames.has(meal.name.toLowerCase().trim())) {
      skipped++;
    } else {
      await db.meals.add(meal);
      existingNames.add(meal.name.toLowerCase().trim());
      added++;
    }
  }
  return { added, skipped, total: data.meals.length };
}

/**
 * Share meals using the Web Share API (mobile native share sheet)
 */
export async function shareMealsFile() {
  const json = await exportMeals();
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], `spicehub-meals.json`, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: 'SpiceHub Meals Backup',
      text: 'My SpiceHub meal library',
      files: [file],
    });
    return true;
  }
  // Fallback: download
  downloadMealsFile();
  return false;
}
