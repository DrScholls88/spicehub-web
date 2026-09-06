// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED IMPORT ENGINE — public barrel.
//
// New code should import from HERE, not from recipeParser.js directly. As the
// monolith is dismantled (spec build-order step 5+), implementations migrate
// behind this barrel without touching consumers.
//
//   import { importRecipeFromUrl, structurePack, JUNK_PATTERNS } from '../import/index.js';
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
export { acquirePhotoPack } from './acquire/photo.js';
export { acquireBlogPack } from './acquire/blog.js';
export { acquireRedditPack } from './acquire/reddit.js';

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
  parseCaption,
  parseHtml,
  detectImportType,
  isInstagramUrl,
  isSocialMediaUrl,
  transcribeVideoForRecipe,
  transcribeFileForRecipe,
  scoreExtractionConfidence,
  getSocialPlatform,
  extractMultipleUrls,
} from '../recipeParser.js';

// Photo/PDF import entry point. Re-exported here so callers reach the whole
// import surface through one module; photoImportEngine itself still imports
// recipeParser directly (see the exemption list in eslint.config.js) because
// routing it through this barrel would create a cycle.
export { importRecipeFromPages, PhotoImportError } from '../lib/photoImportEngine.js';

// The thin import spine — detect → acquire → structure → gate → return.
// New callers should use importRequest() instead of reaching into
// recipeParser.js directly.
export { importRequest, restructure, detectAcquireFork } from './engine.js';

// Source detection (distinct from detectImportType which detects kind).
export { detectSource, extractUrl } from './detectSource.js';
// Caption cleaning + weakness detection (extracted from recipeParser)
export { cleanSocialCaption, isCaptionWeak } from './clean/socialCaption.js';

export { gateRecipe } from './gate.js';
