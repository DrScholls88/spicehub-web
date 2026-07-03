// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED IMPORT ENGINE — public barrel.
//
// New code should import from HERE, not from recipeParser.js directly. As the
// monolith is dismantled (spec build-order step 5+), implementations migrate
// behind this barrel without touching consumers.
//
//   import { importRecipeFromUrl, structurePack, JUNK_PATTERNS } from '@/import';
// ─────────────────────────────────────────────────────────────────────────────

// The seam
export {
  createContextPack,
  addProvenance,
  packHasCompleteCandidate,
  buildPackSections,
  PACK_BUDGET,
} from './contextPack.js';

// The zero-junk contract (single source)
export {
  JUNK_PATTERNS,
  STRONG_LINE_JUNK,
  BAIT_ONLY_RE,
  isJunkLine,
  stripJunkLines,
  findJunk,
  lineHasRecipeSignal,
  countQuantityLines,
} from './junk.js';

// Acquisition
export { acquireWebsitePack, packFromExtractResponse, extractEndpoint } from './acquire/website.js';
export { acquireInstagramPack, instagramShortcode } from './acquire/instagram.js';

// Images
export {
  gateImageHeuristics,
  visionValidateDishPhoto,
  persistCarousel,
  selectHeroImage,
  MAX_CAROUSEL,
} from './images.js';

// Structuring (the single brain)
export {
  structurePack,
  serverStructurePack,
  structureEndpoint,
  buildPackContents,
  geminiPackRequest,
  sanitizeModelJson,
  RECONCILIATION_RULES,
  VERIFIER_RULES,
  PACK_RESPONSE_SCHEMA,
} from './structure/gemini.js';

// Pipeline entry points + shared post-processing (still hosted in the
// recipeParser monolith; these re-exports are the stable public surface
// consumers should target so implementations can move without churn).
export {
  importRecipeFromUrl,
  parseFromUrl,
  importFromInstagram,
  captionToRecipe,
  structureWithAI,
  structureWithAIClient,
  structureDeterministic,
  structureRecipeFromImage,
  enforceDeterministicRules,
  cleanSocialCaption,
  isCaptionWeak,
  parseCaption,
  parseHtml,
  detectImportType,
  isInstagramUrl,
  isSocialMediaUrl,
  transcribeVideoForRecipe,
  transcribeFileForRecipe,
} from '../recipeParser.js';
