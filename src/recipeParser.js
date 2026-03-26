/**
 * SpiceHub Recipe Parser
 * Strategy (mirrors Paprika 3):
 *   1. ALL URLs      → server-side extraction first (server.js /api/extract-url)
 *      • Social media URLs → headless Chrome (real browser, renders JS like Paprika's WebView)
 *      • Recipe blogs      → fast HTTP fetch + JSON-LD / OG meta parsing
 *   2. CORS PROXY    → fallback if server unreachable (limited for social media)
 *   3. CAPTION TEXT  → 4-pass heuristic parser (used internally on extracted captions)
 */

// ─── Title sanitizer (public export, delegates to cleanTitle) ────────────────
export function sanitizeRecipeTitle(raw) {
  return cleanTitle(raw);
}

// ─── Social media detection ───────────────────────────────────────────────────
const SOCIAL_DOMAINS = [
  'instagram.com', 'www.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'facebook.com', 'www.facebook.com', 'fb.watch',
  'pinterest.com', 'www.pinterest.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'twitter.com', 'x.com',
];

export function isSocialMediaUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_DOMAINS.some(d => d.replace(/^www\./, '') === host);
  } catch { return false; }
}

export function getSocialPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('instagram')) return 'Instagram';
    if (host.includes('tiktok')) return 'TikTok';
    if (host.includes('facebook') || host === 'fb.watch') return 'Facebook';
    if (host.includes('pinterest')) return 'Pinterest';
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube';
    if (host.includes('twitter') || host === 'x.com') return 'X / Twitter';
    return 'Social Media';
  } catch { return 'Social Media'; }
}

// ─── Mealie-inspired image selection: pick the best/largest from candidates ──
// JSON-LD `image` can be: a string, an array of strings, an ImageObject,
// an array of ImageObjects, or nested combinations.
function selectBestImage(imageField) {
  if (!imageField) return '';

  const candidates = [];
  function collect(val) {
    if (!val) return;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && (trimmed.startsWith('http') || trimmed.startsWith('//'))) {
        candidates.push(trimmed);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) collect(item);
      return;
    }
    if (typeof val === 'object') {
      if (val.url) collect(val.url);
      else if (val.contentUrl) collect(val.contentUrl);
      else if (val['@id']) collect(val['@id']);
      if (val.thumbnail?.url) collect(val.thumbnail.url);
    }
  }

  collect(imageField);
  if (candidates.length === 0) return '';
  if (candidates.length === 1) return candidates[0];

  function scoreUrl(url) {
    let score = 0;
    const sizeMatch = url.match(/(\d{3,4})x(\d{3,4})/);
    if (sizeMatch) score = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2]);
    if (/\b(full|large|original|hero|featured)\b/i.test(url)) score += 500000;
    if (/\b(thumb|small|tiny|icon|avatar|s150|s320|150x150|320x320)\b/i.test(url)) score -= 1000000;
    score += url.length;
    return score;
  }

  candidates.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return candidates[0];
}

// ─── Ingredient / Direction heuristics ────────────────────────────────────────
const UNITS_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|medium|large|small|whole|half|to taste|chopped|diced|minced|sliced|crushed|grated|shredded|fresh|dried|frozen)\b/i;
const BULLET_RE = /^[-•*▪▸►◦‣⁃✓✔]\s*/;
const FRACTION_RE = /^[½¼¾⅓⅔⅛⅜⅝⅞\d]/;
const NUM_UNIT_RE = /^[\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s]*\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|sprigs?|heads?|stalks?)/i;
const STEP_NUM_RE = /^\d+[.):\s-]/;
const COOKING_VERBS_RE = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave|stir-fry|deep.fry|pan.fry|air.fry)\b/i;

// Common food words that indicate an ingredient line even without a unit
const FOOD_RE = /\b(chicken|beef|pork|salmon|shrimp|tofu|rice|pasta|noodles|bread|flour|sugar|butter|oil|olive oil|garlic|onion|onions|tomato|tomatoes|pepper|peppers|salt|cheese|cream|milk|eggs?|lemon|lime|vinegar|soy sauce|honey|ginger|cilantro|parsley|basil|oregano|cumin|paprika|cinnamon|avocado|potato|potatoes|broccoli|spinach|mushrooms?|carrots?|celery|corn|beans?|chickpeas?|lentils?|coconut|vanilla|chocolate|bacon|sausage|ham|turkey|lettuce|cucumber|zucchini|bell pepper|jalape[nñ]o|mayo|mayonnaise|mustard|ketchup|sriracha|sesame|peanut|almond|walnut|cashew|oats?|yogurt|sour cream|cream cheese|mozzarella|parmesan|cheddar|feta|ricotta|tortilla|pita|naan|wonton|dumpling)\b/i;

function looksLikeIngredient(line) {
  if (BULLET_RE.test(line)) return true;
  if (NUM_UNIT_RE.test(line)) return true;
  if (line.length < 100 && UNITS_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 80 && UNITS_RE.test(line)) return true;
  // Short lines with food words are likely ingredients
  if (line.length < 60 && FOOD_RE.test(line) && FRACTION_RE.test(line)) return true;
  if (line.length < 40 && FOOD_RE.test(line)) return true;
  return false;
}

function looksLikeDirection(line) {
  if (STEP_NUM_RE.test(line)) return true;
  if (COOKING_VERBS_RE.test(line)) return true;
  return false;
}

const INGREDIENTS_HEADERS = [
  'ingredients', 'you will need', "you'll need", 'what you need',
  "what you'll need", 'shopping list', 'what you\'ll need',
  'for the', 'for this recipe', 'recipe ingredients',
];
const DIRECTIONS_HEADERS = [
  'directions', 'instructions', 'method', 'steps', 'preparation',
  'how to make', 'how to prepare', 'to make', 'to prepare',
  'the process', 'process', 'let\'s make', "let's make",
  'how to cook', 'cooking instructions', 'recipe instructions',
  'procedure', 'directions:', 'instructions:',
];

function isIngredientsHeader(lower) {
  return INGREDIENTS_HEADERS.some(h => lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}
function isDirectionsHeader(lower) {
  return DIRECTIONS_HEADERS.some(h => lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' -'));
}

// ─── Caption Parser wrapper (used by BrowserImport) ─────────────────────────
export function parseManualCaption(captionText, sourceUrl) {
  const parsed = parseCaption(captionText);
  return {
    name: parsed.title || 'Imported Recipe',
    ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
    directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
    imageUrl: '',
    link: sourceUrl || '',
  };
}

// ─── Caption Parser (Paprika-style 4-pass, enhanced for video content) ─────────
export function parseCaption(text) {
  const ingredients = [];
  const directions = [];
  let title = null;

  if (!text || !text.trim()) return { title, ingredients, directions };

  // PASS 0: Pre-process video transcript content
  // Detect and handle "Transcript:" sections from yt-dlp subtitle extraction
  let hasTranscript = false;
  const transcriptIdx = text.indexOf('\nTranscript:\n');
  let descriptionPart = text;
  let transcriptPart = '';
  if (transcriptIdx >= 0) {
    hasTranscript = true;
    descriptionPart = text.substring(0, transcriptIdx).trim();
    transcriptPart = text.substring(transcriptIdx + '\nTranscript:\n'.length).trim();
  }

  // If we have both description and transcript, try to parse description first
  // (descriptions often have structured ingredients), transcript for directions
  if (hasTranscript && descriptionPart.length > 30) {
    const descParsed = parseCaption(descriptionPart);
    const transParsed = parseSpeechTranscript(transcriptPart);

    // Merge: use description ingredients if found, otherwise transcript
    const mergedIngredients = descParsed.ingredients.length > 0
      ? descParsed.ingredients
      : transParsed.ingredients;
    const mergedDirections = descParsed.directions.length > 0
      ? descParsed.directions
      : transParsed.directions;

    return {
      title: descParsed.title || transParsed.title,
      ingredients: mergedIngredients,
      directions: mergedDirections.length > 0 ? mergedDirections : transParsed.directions,
    };
  }

  // If only transcript (no description), parse as spoken content
  if (hasTranscript && !descriptionPart) {
    return parseSpeechTranscript(transcriptPart);
  }

  // PASS 1: Clean text
  text = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')        // zero-width / soft-hyphen
    .replace(/\u2019/g, "'").replace(/\u2018/g, "'")      // smart quotes
    .replace(/\u201C/g, '"').replace(/\u201D/g, '"')
    .replace(/\u2026/g, '...').replace(/\u2013/g, '-').replace(/\u2014/g, '-')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // PASS 1.5: Handle YouTube timestamp format (e.g. "2:30 - Add the garlic")
  // Convert timestamps into step separators
  text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]\s*/gm, '');
  // Also handle "0:00 Intro\n0:30 Ingredients\n2:00 Steps" style descriptions
  const timestampLines = text.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm);
  if (timestampLines && timestampLines.length >= 3) {
    // This looks like a YouTube chapter list — convert to structured text
    text = text.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/gm, '');
  }

  // PASS 1.6: Handle abbreviated social media recipe formats
  // e.g. "1c flour, 2 eggs, mix & bake 350° 25min"
  const ABBREV_RE = /^[\d½¼¾⅓⅔][\d./]*\s*[a-z]{1,4}\s+\w+(?:\s*,\s*[\d½¼¾⅓⅔][\d./]*\s*[a-z]{1,4}\s+\w+){2,}/i;
  if (ABBREV_RE.test(text.trim()) && text.trim().length < 300) {
    // Entire text is a comma-separated abbreviated recipe
    const parts = text.split(/\s*,\s*/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (looksLikeIngredient(trimmed) && !looksLikeDirection(trimmed)) {
        ingredients.push(trimmed);
      } else if (looksLikeDirection(trimmed)) {
        directions.push(trimmed);
      } else if (trimmed.length < 40 && NUM_UNIT_RE.test(trimmed)) {
        ingredients.push(trimmed);
      } else {
        directions.push(trimmed);
      }
    }
    return {
      title: null,
      ingredients,
      directions,
    };
  }

  const lines = text.split('\n');
  let inIngredients = false;
  let inDirections = false;
  let foundSections = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    const lower = line.toLowerCase().replace(/[*_~`]/g, '').trim();

    // PASS 2: Detect explicit section headers
    if (isIngredientsHeader(lower)) {
      foundSections = true;
      inIngredients = true;
      inDirections = false;
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0 && colonIdx < line.length - 1) {
        line = line.substring(colonIdx + 1).trim();
        if (!line) continue;
      } else {
        continue;
      }
    } else if (isDirectionsHeader(lower)) {
      foundSections = true;
      inIngredients = false;
      inDirections = true;
      const colonIdx = line.indexOf(':');
      if (colonIdx >= 0 && colonIdx < line.length - 1) {
        line = line.substring(colonIdx + 1).trim();
        if (!line) continue;
      } else {
        continue;
      }
    }

    // Strip hashtags and @mentions (keep the rest of the line)
    let cleanLine = line.replace(/#\w[\w.]*/g, '').replace(/@\w+/g, '').trim();
    if (!cleanLine) continue;

    // Extract title from the first meaningful line before any section
    if (title === null && !inIngredients && !inDirections && !foundSections) {
      const isBulletOrNum = BULLET_RE.test(cleanLine) || STEP_NUM_RE.test(cleanLine);
      if (!isBulletOrNum && cleanLine.length > 3 && !looksLikeIngredient(cleanLine)) {
        let titleCandidate = cleanLine;

        // Remove emoji from title candidates
        titleCandidate = titleCandidate.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}]/gu, '').trim();

        // Long lines — try to extract just the recipe name part
        if (titleCandidate.length >= 80) {
          // Try pipe delimiter first
          const pipeParts = titleCandidate.split(/\s*[|\-–—]\s*/);
          if (pipeParts[0].length > 3 && pipeParts[0].length < 80) {
            titleCandidate = pipeParts[0].trim();
          } else {
            // Try first sentence
            const sentenceEnd = titleCandidate.search(/[.!?]\s/);
            if (sentenceEnd > 3 && sentenceEnd < 100) {
              titleCandidate = titleCandidate.substring(0, sentenceEnd).trim();
            } else {
              titleCandidate = titleCandidate.substring(0, 80).replace(/\s\S+$/, '').trim();
            }
          }
        }

        if (titleCandidate.length > 2) {
          title = cleanTitle(titleCandidate);
          continue;
        }
      }
    }

    // PASS 3: Heuristic fallback classification
    if (!foundSections) {
      const looksIng = looksLikeIngredient(cleanLine);
      const looksDir = looksLikeDirection(cleanLine);

      // Only switch modes if the signal is clear — avoid misclassification
      if (looksIng && !looksDir) {
        // Extra check: if line contains a cooking verb AND a measurement, it's ambiguous
        // e.g. "Add 2 cups flour" — this is a direction that mentions an ingredient
        if (COOKING_VERBS_RE.test(cleanLine) && cleanLine.length > 40) {
          // Long line with cooking verb — treat as direction even if it has measurements
          inIngredients = false; inDirections = true;
        } else {
          inIngredients = true; inDirections = false;
        }
      }
      else if (looksDir && !looksIng) { inIngredients = false; inDirections = true; }
      // If both look true, use length as tiebreaker: short = ingredient, long = direction
      else if (looksIng && looksDir) {
        if (cleanLine.length < 50) { inIngredients = true; inDirections = false; }
        else { inIngredients = false; inDirections = true; }
      }
    }

    // Clean prefix markers
    let cleaned = cleanLine
      .replace(/^[-•*▪▸►◦‣⁃✓✔]\s*/, '')
      .replace(/^\d+[.):\s-]\s*/, '')
      .trim();
    if (!cleaned) continue;

    // PASS 4: Route to correct list
    if (inIngredients) {
      if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
    } else if (inDirections) {
      directions.push(cleaned);
    } else {
      // Final fallback
      if (looksLikeIngredient(cleanLine) && !looksLikeDirection(cleanLine)) {
        if (!ingredients.includes(cleaned)) ingredients.push(cleaned);
      } else if (looksLikeDirection(cleanLine)) {
        directions.push(cleaned);
      }
    }
  }

  return { title, ingredients, directions };
}

// ─── Speech transcript parser (for yt-dlp subtitle content) ──────────────────
// Spoken recipe content is unstructured continuous text. We split it into
// sentences, then classify each sentence as ingredient-like or direction-like.
function parseSpeechTranscript(text) {
  if (!text || text.trim().length < 20) return { title: null, ingredients: [], directions: [] };

  const ingredients = [];
  const directions = [];
  let title = null;

  // Split transcript into sentences
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 3);

  // Filter out common filler/intro phrases
  const FILLER_RE = /^(hey|hi|hello|what's up|welcome|subscribe|like and subscribe|follow me|link in bio|comment below|check out|don't forget|make sure to|hit that|smash that|thanks for watching|see you|bye|peace)/i;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];

    // Skip filler
    if (FILLER_RE.test(s)) continue;

    // Extract title from first meaningful sentence if short enough
    if (title === null && s.length < 80 && !looksLikeIngredient(s) && !FILLER_RE.test(s)) {
      // Check if it sounds like a recipe name: "Today we're making X" / "This is my X recipe"
      const nameMatch = s.match(/(?:mak(?:e|ing)|cook(?:ing)?|prepar(?:e|ing)|recipe for|showing you|teach you)\s+(?:my\s+|this\s+|a\s+|some\s+)?(.{5,60})/i);
      if (nameMatch) {
        title = cleanTitle(nameMatch[1].replace(/[.!?]+$/, ''));
      } else if (i === 0 && s.length < 60) {
        title = cleanTitle(s.replace(/[.!?]+$/, ''));
      }
      continue;
    }

    // Classify: ingredient mentions vs cooking steps
    if (looksLikeIngredient(s) && !looksLikeDirection(s) && s.length < 60) {
      ingredients.push(s.replace(/^[-•*]\s*/, '').replace(/^\d+[.):\s-]\s*/, '').trim());
    } else if (looksLikeDirection(s) || s.length > 40) {
      // Clean up direction-style sentences
      let cleaned = s.replace(/^\d+[.):\s-]\s*/, '').trim();
      if (cleaned.length > 5) directions.push(cleaned);
    }
  }

  return { title, ingredients, directions };
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return decodeHtml(m[1]);
  }
  return null;
}

function cleanTitle(title) {
  if (!title) return 'Imported Recipe';
  title = title
    // Remove "Username on Instagram: ..." prefix
    .replace(/^[\w.\s]+on\s+(Instagram|TikTok|Facebook)\s*:\s*/i, '')
    // Remove "... | Instagram" / "... - TikTok" / "... - YouTube" suffix
    .replace(/\s*[|\-–—•]\s*(Instagram|TikTok|Facebook|Pinterest|YouTube|Reels?).*$/i, '')
    .replace(/\s*on (Instagram|TikTok|Facebook).*$/i, '')
    // Remove social handle prefixes: "Chris • Ⓥ | " or "@username: "
    .replace(/^[^|]*[•\u24cb\u24b6-\u24E9][^|]*\|\s*/u, '')
    .replace(/^@[\w.]+[:\s]+/i, '')
    // Remove handles and hashtags
    .replace(/\s*\(@[\w.]+\).*$/, '')
    .replace(/#\w[\w.]*/g, '')
    // Remove "Reel by username" etc.
    .replace(/^(Reel|Video|Post)\s+by\s+[\w.]+\s*[-–—:.]?\s*/i, '')
    // Remove social media engagement stats
    .replace(/\d+[kKmM]?\s*(likes?|comments?|shares?|views?|saves?)\s*[,.]?\s*/gi, '')
    // Remove "Part N!" suffix
    .replace(/\s*Part\s*\d+!?\s*$/i, '')
    // Remove "Ready in Just N Minutes!" filler
    .replace(/\s*Ready in Just \d+ Minutes!?\s*/i, '')
    // Remove trailing "Welcome" filler
    .replace(/\s*Welcome\s*$/i, '')
    // Remove emojis
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, '')
    // Fix smart quotes
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Remove trailing exclamation marks clutter
  title = title.replace(/[!]+$/, '').trim();

  // If title is too long, try to find a natural break point
  if (title.length > 120) {
    const parts = title.split(/\s*[|\-–—]\s*/);
    if (parts[0].length > 3 && parts[0].length <= 120) {
      title = parts[0].trim();
    } else {
      title = title.substring(0, 115).replace(/\s\S+$/, '').trim();
    }
  }

  // If title ended up empty after cleaning, use fallback
  if (!title || title.length < 2) return 'Imported Recipe';

  // Fix ALL CAPS to Title Case
  if (title === title.toUpperCase() && title.length > 5) {
    title = title.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
  }

  // Capitalize first letter if it's all lowercase
  if (title === title.toLowerCase() && title.length < 80) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

// ─── Flexible instruction parser (Mealie-inspired) ──────────────────────────
// Handles the many formats recipe sites use for instructions:
//   - Array of strings
//   - Array of { text: "..." } objects (HowToStep)
//   - Array of { "@type": "HowToSection", itemListElement: [...] }
//   - A single string (newline-separated or JSON-encoded)
//   - Dict-indexed objects { "0": { text: "..." }, "1": { text: "..." } }
function parseInstructionsFlexible(inst) {
  if (!inst) return [];

  // String — could be newline-separated or a JSON string
  if (typeof inst === 'string') {
    const trimmed = inst.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try { return parseInstructionsFlexible(JSON.parse(trimmed)); }
      catch { /* fall through to split */ }
    }
    return trimmed.split(/[\n\r]+/).map(s => sanitizeInstruction(s)).filter(Boolean);
  }

  // Dict-indexed (e.g. { "0": { text: "..." }, "1": { text: "..." } })
  if (inst && typeof inst === 'object' && !Array.isArray(inst)) {
    const keys = Object.keys(inst);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
      return parseInstructionsFlexible(keys.sort((a, b) => +a - +b).map(k => inst[k]));
    }
    // Single object with text
    const txt = inst.text || inst.name || '';
    return txt ? [sanitizeInstruction(txt.toString())] : [];
  }

  if (!Array.isArray(inst)) return [];

  const directions = [];
  for (const step of inst) {
    if (typeof step === 'string') {
      const clean = sanitizeInstruction(step);
      if (clean) directions.push(clean);
    } else if (step && typeof step === 'object') {
      const t = [].concat(step['@type'] || step.type || []).join(' ').toLowerCase();

      // HowToSection — flatten nested itemListElement
      if (t.includes('howtosection') && Array.isArray(step.itemListElement)) {
        for (const sub of step.itemListElement) {
          const txt = (sub.text || sub.name || '').toString().trim();
          if (txt) directions.push(sanitizeInstruction(txt));
        }
      } else {
        const txt = (step.text || step.name || '').toString().trim();
        if (txt) directions.push(sanitizeInstruction(txt));
      }
    }
  }
  return directions.filter(Boolean);
}

/**
 * Mealie-inspired iterative instruction sanitization:
 * Strip HTML, decode entities, collapse whitespace — loop until stable.
 */
function sanitizeInstruction(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text.trim();
  let prev = '';
  for (let i = 0; i < 5 && clean !== prev; i++) {
    prev = clean;
    clean = decodeHtml(clean.replace(/<[^>]+>/g, ' ').replace(/\xa0/g, ' ').replace(/ +/g, ' ')).trim();
  }
  return clean;
}

// ─── JSON-LD extraction ───────────────────────────────────────────────────────
function findJsonLdRecipes(html) {
  const results = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim());
      const recipe = extractRecipeFromJsonLd(Array.isArray(data) ? data : [data]);
      if (recipe) results.push(recipe);
    } catch { /* skip malformed JSON */ }
  }
  return results;
}

function extractRecipeFromJsonLd(items) {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const type = [].concat(item['@type'] || []).join(' ').toLowerCase();
    if (type.includes('recipe')) return parseRecipeNode(item);
    if (item['@graph']) {
      const r = extractRecipeFromJsonLd([].concat(item['@graph']));
      if (r) return r;
    }
    // Arrays inside item
    for (const val of Object.values(item)) {
      if (Array.isArray(val)) {
        const r = extractRecipeFromJsonLd(val);
        if (r) return r;
      }
    }
  }
  return null;
}

function parseRecipeNode(node) {
  const name = decodeHtml((node.name || '').toString().trim());
  if (!name) return null;

  // Ingredients
  let ingredients = [];
  if (Array.isArray(node.recipeIngredient)) {
    ingredients = node.recipeIngredient
      .map(e => decodeHtml(e.toString().trim()))
      .filter(Boolean);
  }

  // Directions — Mealie-inspired comprehensive parsing:
  // Handles HowToStep, HowToSection, plain strings, JSON strings,
  // dict-indexed steps, and newline-separated blocks.
  let directions = [];
  const inst = node.recipeInstructions;
  directions = parseInstructionsFlexible(inst);

  // Image — Mealie-inspired: pick the best/largest from multiple candidates
  const imageUrl = selectBestImage(node.image);

  return {
    name,
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
  };
}

// ─── Strip social media OG description prefix ────────────────────────────────
// Instagram OG descriptions start with "123 likes, 45 comments - username on Month Day, Year:"
// TikTok starts with "username (@handle). ... | ... likes. ..."
function stripSocialMetaPrefix(text) {
  if (!text) return text;
  // Instagram: "123 likes, 45 comments - username on Month Day, Year:"
  text = text.replace(/^[\d,.]+[kKmM]?\s+likes?,?\s*[\d,.]+[kKmM]?\s+comments?\s*[-–—]\s*[^:]+:\s*/i, '');
  // Instagram alt: "username shared a post on Instagram: "..."
  text = text.replace(/^[\w.]+\s+shared\s+a\s+(post|reel)\s+on\s+Instagram\s*:\s*/i, '');
  // TikTok: "username (@handle). description | 123 Likes..."
  text = text.replace(/^[\w.]+\s*\(@[\w.]+\)\.\s*/i, '');
  // Remove trailing " | 123 Likes. 45 Comments. ..."
  text = text.replace(/\s*\|\s*[\d,.]+[kKmM]?\s+Likes\..*$/i, '');
  return text.trim();
}

// ─── CORS proxy cascade (fully client-side, no server needed) ─────────────────
const PROXIES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchHtmlViaProxy(url, timeoutMs = 15000) {
  for (const makeProxy of PROXIES) {
    const proxyUrl = makeProxy(url);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text.includes('Log in') && text.includes('instagram') && text.length < 20000) {
        continue; // Instagram login wall — try next proxy
      }
      if (text.length < 500) continue; // Likely an error page
      return text;
    } catch { /* try next proxy */ }
  }
  return null;
}

// ─── Instagram embed extraction (client-side via CORS proxy) ──────────────────
function extractInstagramShortcode(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function isInstagramUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch { return false; }
}

async function extractInstagramEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  console.log(`[instagram-embed] Trying embed page: ${embedUrl}`);

  try {
    const html = await fetchHtmlViaProxy(embedUrl, 15000);
    if (!html) { console.log('[instagram-embed] CORS proxy returned no data'); return null; }
    if (html.length < 5000 && (html.includes('Log in') || html.includes('login'))) {
      console.log('[instagram-embed] Login wall detected'); return null;
    }

    // Extract caption
    let caption = '';
    const captionPatterns = [
      /<div\s+class="[^"]*Caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<div\s+class="[^"]*EmbedCaption[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*[Cc]aption[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
    ];
    for (const re of captionPatterns) {
      const m = re.exec(html);
      if (m && m[1]) {
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (text && text.length > 15) { caption = text; break; }
      }
    }
    // JSON data fallback
    if (!caption) {
      const dataPatterns = [
        /"caption"\s*:\s*\{\s*"text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/,
        /"text"\s*:\s*"([^"]{20,}(?:\\.[^"]*)*)"/,
      ];
      for (const re of dataPatterns) {
        const m = re.exec(html);
        if (m && m[1]) {
          try { caption = JSON.parse('"' + m[1] + '"'); } catch { caption = m[1]; }
          if (caption.length > 15) break; else caption = '';
        }
      }
    }
    // OG description fallback
    if (!caption) {
      const og = extractMeta(html, 'og:description');
      if (og && og.length > 15) caption = og;
    }

    // Extract image
    let imageUrl = extractMeta(html, 'og:image') || '';
    if (!imageUrl) {
      const imgPatterns = [
        /<img[^>]+src="(https:\/\/[^"]*instagram[^"]*\/[^"]*_n\.jpg[^"]*)"/i,
        /<img[^>]+src="(https:\/\/scontent[^"]+)"/i,
        /"display_url"\s*:\s*"(https:[^"]+)"/i,
        /"thumbnail_src"\s*:\s*"(https:[^"]+)"/i,
      ];
      for (const re of imgPatterns) {
        const m = re.exec(html);
        if (m) { imageUrl = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&'); break; }
      }
    }

    // Extract title
    let title = cleanTitle(extractMeta(html, 'og:title') || '');

    if (!caption && !title) { console.log('[instagram-embed] No data found'); return null; }

    console.log(`[instagram-embed] Success — caption: ${caption.length} chars, image: ${imageUrl ? 'yes' : 'no'}`);
    return { ok: true, type: 'caption', caption: stripSocialMetaPrefix(caption), title, imageUrl, sourceUrl: url };
  } catch (e) {
    console.log(`[instagram-embed] Error: ${e.message}`);
    return null;
  }
}

// ─── Convert embed extraction result → recipe format ─────────────────────────
function handleEmbedResult(data, sourceUrl) {
  if (!data || !data.ok) return null;

  const caption = stripSocialMetaPrefix(data.caption || '');
  const parsed = parseCaption(caption);
  let title = data.title || parsed.title || 'Imported Recipe';
  title = cleanTitle(title);

  return {
    name: title,
    ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
    directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
    imageUrl: data.imageUrl || '',
    link: data.sourceUrl || sourceUrl,
  };
}

// ── Server API helpers for unified pipeline ──────────────────────────────────
// The server (server/index.js) provides yt-dlp and headless Chrome capabilities.
// These are optional — if the server is unavailable, we fall back to client-side.

let _serverBaseUrl = null;
let _serverChecked = false;

/**
 * Detect the SpiceHub server URL. Tries common locations.
 * Returns base URL string or null if server is not available.
 */
async function detectServer() {
  if (_serverChecked) return _serverBaseUrl;
  _serverChecked = true;

  const candidates = [
    // Same origin (if deployed together)
    window.location.origin,
    // Local dev
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];

  for (const base of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(`${base}/api/status`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) {
          _serverBaseUrl = base;
          console.log(`[SpiceHub] Server found at ${base} (yt-dlp: ${data.ytdlpAvailable ? 'yes' : 'no'})`);
          return _serverBaseUrl;
        }
      }
    } catch { /* try next */ }
  }

  console.log('[SpiceHub] No server found — using client-side only');
  return null;
}

/** Reset server detection (e.g. after network change) */
export function resetServerDetection() {
  _serverBaseUrl = null;
  _serverChecked = false;
}

/**
 * Try server-side extraction (yt-dlp + headless Chrome).
 * Returns parsed recipe object or null.
 */
async function tryServerExtraction(url, onProgress) {
  const serverUrl = await detectServer();
  if (!serverUrl) return null;

  try {
    if (onProgress) onProgress('Extracting via server (yt-dlp + metadata)...');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);

    const resp = await fetch(`${serverUrl}/api/extract-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok) return null;

    // Handle different response types
    if (data.type === 'jsonld' && data.recipe) {
      // Structured recipe data from JSON-LD
      const recipe = parseRecipeFromServerJsonLd(data.recipe);
      if (recipe) {
        recipe.link = data.sourceUrl || url;
        recipe.imageUrl = recipe.imageUrl || data.imageUrl || '';
        recipe._extractedVia = data.extractedVia || 'server';
        return recipe;
      }
    }

    if (data.type === 'caption' || data.type === 'video-meta') {
      // Caption text (from yt-dlp description + subtitles, or headless Chrome)
      const captionText = data.caption || '';
      if (captionText.length > 15) {
        const parsed = parseCaption(captionText);
        const recipe = {
          name: data.title ? cleanTitle(data.title) : (parsed.title || 'Imported Recipe'),
          ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : ['See original post for ingredients'],
          directions: parsed.directions.length > 0 ? parsed.directions : ['See original post for directions'],
          imageUrl: data.imageUrl || data.thumbnail || '',
          link: data.sourceUrl || url,
          _extractedVia: data.extractedVia || 'server',
          _hasSubtitles: data.hasSubtitles || false,
        };
        return recipe;
      }

      // Even if caption is minimal, if we got title + image, return what we have
      if (data.title) {
        return {
          name: cleanTitle(data.title),
          ingredients: ['See original post for ingredients'],
          directions: ['See original post for directions'],
          imageUrl: data.imageUrl || data.thumbnail || '',
          link: data.sourceUrl || url,
          _extractedVia: data.extractedVia || 'server',
          _hasSubtitles: false,
        };
      }
    }

    // Login wall or empty result from server
    if (data.type === 'none') {
      if (data.isLoginWall) {
        return { _error: true, reason: 'login-wall', platform: getSocialPlatform(url) };
      }
      return null;
    }

    return null;
  } catch (e) {
    console.log(`[SpiceHub] Server extraction error: ${e.message}`);
    return null;
  }
}

/** Parse a JSON-LD recipe object from the server response */
function parseRecipeFromServerJsonLd(recipe) {
  if (!recipe || !recipe.name) return null;

  let ingredients = [];
  if (Array.isArray(recipe.recipeIngredient)) {
    ingredients = recipe.recipeIngredient.map(i => i.toString().trim()).filter(Boolean);
  }

  let directions = parseInstructionsFlexible(recipe.recipeInstructions);

  const imageUrl = selectBestImage(recipe.image);

  return {
    name: cleanTitle(recipe.name),
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl: imageUrl || '',
  };
}

/**
 * Main entry: parse recipe from a URL.
 * Mealie-inspired unified pipeline — tries multiple strategies automatically.
 *
 * Strategy (in order):
 *   1. Instagram URLs → embed extraction, then server (yt-dlp + Chrome)
 *   2. Video/Social URLs → server (yt-dlp metadata + subtitles), then CORS proxy
 *   3. Recipe blogs → CORS proxy + JSON-LD / microdata / CSS heuristics
 *   4. All strategies exhausted → guide user to Paste Text
 *
 * @param {string} url - The URL to import from
 * @param {function} onProgress - Optional callback for progress updates
 * Returns { name, ingredients, directions, link, imageUrl }
 *      or { _error: true, reason } on failure
 *      or null if completely failed
 */
export async function parseFromUrl(url, onProgress) {

  // ── 1. Instagram: try embed first, then server extraction ──
  if (isInstagramUrl(url)) {
    console.log('[SpiceHub] Instagram URL — trying embed extraction...');
    if (onProgress) onProgress('Trying Instagram embed extraction...');

    // Try client-side embed extraction first (fastest)
    const embedResult = await extractInstagramEmbed(url);
    if (embedResult && embedResult.ok && embedResult.caption && embedResult.caption.length > 20) {
      const recipe = handleEmbedResult(embedResult, url);
      if (recipe && recipe.ingredients[0] !== 'See original post for ingredients') {
        return recipe;
      }
    }

    // Try server-side extraction (yt-dlp + headless Chrome)
    if (onProgress) onProgress('Trying server extraction (yt-dlp)...');
    const serverResult = await tryServerExtraction(url, onProgress);
    if (serverResult && !serverResult._error) return serverResult;

    // Instagram server failed — route to BrowserAssist
    console.log('[SpiceHub] Instagram extraction failed — routing to BrowserAssist');
    return null;
  }

  // ── 2. Video/Social URLs: try server first (yt-dlp), then CORS proxy ──
  if (isSocialMediaUrl(url)) {
    console.log('[SpiceHub] Social/video URL — trying server extraction...');

    // Server-side: yt-dlp metadata + subtitles + headless Chrome
    if (onProgress) onProgress('Extracting video metadata and subtitles...');
    const serverResult = await tryServerExtraction(url, onProgress);
    if (serverResult && !serverResult._error) return serverResult;

    // Fallback: CORS proxy (sometimes works for public pages)
    if (onProgress) onProgress('Trying direct extraction...');
    try {
      const html = await fetchHtmlViaProxy(url);
      if (html) {
        const recipe = parseHtml(html, url);
        if (recipe) return recipe;
      }
    } catch {
      console.log('[SpiceHub] Social media CORS proxy failed');
    }

    return { _error: true, reason: 'social-fetch-failed', platform: getSocialPlatform(url) };
  }

  // ── 3. Recipe blogs: CORS proxy first (fast), server fallback ──
  console.log('[SpiceHub] Fetching recipe via CORS proxy...');
  if (onProgress) onProgress('Extracting recipe from page...');
  try {
    const html = await fetchHtmlViaProxy(url);
    if (html) {
      const recipe = parseHtml(html, url);
      if (recipe) return recipe;
    }
  } catch (e) {
    console.log('[SpiceHub] CORS proxy failed:', e.message);
  }

  // CORS proxy failed — try server-side extraction as fallback
  if (onProgress) onProgress('Trying server-side extraction...');
  const serverResult = await tryServerExtraction(url, onProgress);
  if (serverResult && !serverResult._error) return serverResult;

  // ── 4. All methods exhausted ──
  return null;
}

/**
 * Parse recipe from raw HTML.
 * Multi-pass strategy (mirrors Paprika 3):
 *   1. JSON-LD structured data
 *   2. Microdata (Schema.org itemscope)
 *   3. Heuristic CSS class matching
 *   4. OG meta tags fallback
 */
export function parseHtml(html, sourceUrl) {
  // 1. JSON-LD (best, most reliable)
  const [jsonLdRecipe] = findJsonLdRecipes(html);
  if (jsonLdRecipe) {
    return { ...jsonLdRecipe, link: sourceUrl };
  }

  // 2. Microdata (itemprop/itemtype)
  const microdataRecipe = extractMicrodataFromHtml(html);
  if (microdataRecipe) {
    return { ...microdataRecipe, link: sourceUrl };
  }

  // 3. Heuristic CSS class matching (WPRM, Tasty, etc.)
  const heuristicRecipe = extractRecipeByCSS(html);
  if (heuristicRecipe) {
    return { ...heuristicRecipe, link: sourceUrl };
  }

  // 4. Meta tags fallback
  let title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title');
  let description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description');
  let imageUrl = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image') || '';

  if (!imageUrl) {
    const posterM = /<video[^>]*poster\s*=\s*["']([^"']+)["']/i.exec(html);
    if (posterM) imageUrl = posterM[1];
  }

  if (!title) return null;
  title = cleanTitle(title);

  // Strip social media prefix from description
  description = stripSocialMetaPrefix(description || '');

  let ingredients = ['See original recipe for ingredients'];
  let directions = ['See original recipe for directions'];

  if (description) {
    const parsed = parseCaption(description);
    if (parsed.ingredients.length > 0) ingredients = parsed.ingredients;
    if (parsed.directions.length > 0) directions = parsed.directions;
    if (parsed.title) title = parsed.title;
  }

  return { name: title, ingredients, directions, link: sourceUrl, imageUrl };
}

// ── Client-side Microdata extraction ──────────────────────────────────────────
function extractMicrodataFromHtml(html) {
  if (!html.includes('schema.org/Recipe')) return null;

  const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Name
  const nameRe = /<[^>]*itemprop\s*=\s*["']name["'][^>]*>([^<]+)/i;
  const nameM = nameRe.exec(html);
  const name = nameM ? decodeHtml(nameM[1].trim()) : '';
  if (!name) return null;

  // Ingredients
  const ingredients = [];
  const ingRe = /<[^>]*itemprop\s*=\s*["']recipeIngredient["'][^>]*>([\s\S]*?)<\/(?:li|span|div|p)>/gi;
  let m;
  while ((m = ingRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 2) ingredients.push(text);
  }

  // Instructions
  const directions = [];
  const instRe = /<[^>]*itemprop\s*=\s*["']recipeInstructions["'][^>]*>([\s\S]*?)<\/(?:li|div|ol|section)>/gi;
  while ((m = instRe.exec(html)) !== null) {
    const text = stripTags(decodeHtml(m[1]));
    if (text && text.length > 5) directions.push(text);
  }

  if (ingredients.length === 0 && directions.length === 0) return null;

  const imageUrl = extractMeta(html, 'og:image') || '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
  };
}

// ── Client-side heuristic CSS class extraction ─────────────────────────────────
function extractRecipeByCSS(html) {
  const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Look for popular recipe plugin patterns
  const ingPatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*ingredient-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|span|div)>/gi,
  ];

  const ingredients = [];
  for (const re of ingPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = stripTags(decodeHtml(m[1]));
      if (text && text.length > 2 && text.length < 200) ingredients.push(text);
    }
    if (ingredients.length > 0) break;
  }

  const dirPatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*tasty-recipe[s]?-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*recipe-instruction[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    /class\s*=\s*["'][^"']*step-text[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|p)>/gi,
  ];

  const directions = [];
  for (const re of dirPatterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = stripTags(decodeHtml(m[1]));
      if (text && text.length > 5) directions.push(text);
    }
    if (directions.length > 0) break;
  }

  if (ingredients.length === 0 && directions.length === 0) return null;

  // Get title from recipe plugin or OG
  let name = '';
  const titlePatterns = [
    /class\s*=\s*["'][^"']*wprm-recipe-name[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*tasty-recipes-title[^"']*["'][^>]*>([^<]+)/i,
    /class\s*=\s*["'][^"']*recipe[_-]?title[^"']*["'][^>]*>([^<]+)/i,
  ];
  for (const re of titlePatterns) {
    const m = re.exec(html);
    if (m) { name = decodeHtml(m[1].trim()); break; }
  }
  if (!name) name = extractMeta(html, 'og:title') || 'Imported Recipe';
  name = cleanTitle(name);

  return {
    name,
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl: extractMeta(html, 'og:image') || '',
  };
}

// ── Extract recipe from DOM (used by BrowserAssist for visible page content) ──────
/**
 * Extract recipe from visible DOM content (text + image URLs).
 * Called by BrowserAssist when user clicks "Extract Recipe" button on visible page.
 * Tries: parseCaption() first, then heuristic line classification.
 * Returns recipe object or null if nothing found.
 */
export function extractRecipeFromDOM(visibleText, imageUrls = [], sourceUrl = '') {
  if (!visibleText || visibleText.trim().length < 10) return null;

  // First try parseCaption to split ingredients/directions
  let parsed = parseCaption(visibleText);
  let name = parsed.title || 'Imported Recipe';
  let ingredients = parsed.ingredients;
  let directions = parsed.directions;

  // If parseCaption didn't find clear structure, use heuristic classification
  if (ingredients.length === 0 && directions.length === 0) {
    const lines = visibleText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length > 0) {
      const classified = { ingredients: [], directions: [] };
      classifyDOMLines(lines, classified);
      ingredients = classified.ingredients;
      directions = classified.directions;
    }
  }

  // If still nothing found, put all text in directions
  if (ingredients.length === 0 && directions.length === 0) {
    const lines = visibleText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length > 0) {
      directions = lines;
    } else {
      return null;
    }
  }

  // Pick best image from available URLs
  let imageUrl = '';
  if (imageUrls && imageUrls.length > 0) {
    imageUrl = imageUrls[0];
  }

  return {
    name: cleanTitle(name),
    ingredients: ingredients.length ? ingredients : ['See recipe for ingredients'],
    directions: directions.length ? directions : ['See recipe for directions'],
    imageUrl,
    link: sourceUrl,
  };
}

// ── Helper: Classify DOM lines into ingredients vs directions ──
// Mutates recipe.ingredients and recipe.directions in place.
function classifyDOMLines(lines, recipe) {
  // Measurement units that strongly indicate ingredients
  const UNIT_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|cloves?|cans?|packages?|sticks?|slices?|bunch)\b/i;
  // Fractions at start of line strongly indicate ingredients
  const STARTS_WITH_NUM = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/;
  // Cooking action verbs strongly indicate directions
  const COOKING_VERB = COOKING_VERBS_RE;
  // Numbered step at start
  const STEP_NUM = /^\d+[.):\s-]\s*/;

  let inIngredients = false;
  let inDirections = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section headers
    const lower = trimmed.toLowerCase();
    if (/^ingredients?:?\s*$/i.test(lower) || lower === 'you will need' || lower === "what you'll need") {
      inIngredients = true;
      inDirections = false;
      continue;
    }
    if (/^(directions?|instructions?|method|steps?|preparation):?\s*$/i.test(lower)) {
      inIngredients = false;
      inDirections = true;
      continue;
    }

    // If we're in a detected section, use that
    if (inIngredients) {
      recipe.ingredients.push(trimmed);
      continue;
    }
    if (inDirections) {
      recipe.directions.push(trimmed);
      continue;
    }

    // Heuristic classification
    const hasUnit = UNIT_RE.test(trimmed);
    const startsWithNum = STARTS_WITH_NUM.test(trimmed);
    const hasCookingVerb = COOKING_VERB.test(trimmed);
    const hasStepNum = STEP_NUM.test(trimmed);
    const isShort = trimmed.length < 50;

    // Strong ingredient signals
    if ((startsWithNum && hasUnit) || (isShort && hasUnit && !hasCookingVerb)) {
      recipe.ingredients.push(trimmed);
    }
    // Strong direction signals
    else if (hasCookingVerb || hasStepNum || trimmed.length > 80) {
      recipe.directions.push(trimmed);
    }
    // Moderate: starts with number + short = ingredient
    else if (startsWithNum && isShort) {
      recipe.ingredients.push(trimmed);
    }
    // Default: longer lines are more likely directions
    else if (trimmed.length > 40) {
      recipe.directions.push(trimmed);
    }
    // Short lines without clear signal — guess ingredient
    else {
      recipe.ingredients.push(trimmed);
    }
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// ENHANCED RECIPE EXTRACTION FUNCTIONS (Production-Ready)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect recipe plugins and structured markup in DOM/HTML content.
 *
 * Recognizes:
 *   - WPRM (WP Recipe Maker) — .wprm-recipe, data-json
 *   - Tasty Recipes — .tasty-recipes, schema.org JSON-LD
 *   - EasyRecipe — .EasyRecipeType
 *   - Schema.org Recipe — JSON-LD @type: Recipe
 *   - Semantic HTML — <article>, <section> with microdata/aria labels
 *   - Common CSS patterns — recipe-ingredient, recipe-instruction, etc.
 *
 * Returns: { type, title, ingredients, directions, imageUrl, meta }
 *   type: 'wprm' | 'tasty' | 'easyrecipe' | 'jsonld' | 'semantic' | null
 *   Each returns normalized { title, ingredients: [...], directions: [...], imageUrl }
 */
export function detectRecipePlugins(domOrHtml) {
  // Support both DOM Document and HTML string
  let doc = domOrHtml;
  if (typeof domOrHtml === 'string') {
    const parser = new DOMParser();
    doc = parser.parseFromString(domOrHtml, 'text/html');
  }

  // ── WPRM (WP Recipe Maker) Detection ──
  const wprmContainer = doc.querySelector('.wprm-recipe, [data-wprm-recipe]');
  if (wprmContainer) {
    const result = extractWPRM(wprmContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'wprm', ...result };
    }
  }

  // ── Tasty Recipes Detection ──
  const tastyContainer = doc.querySelector('.tasty-recipes, [data-tasty-recipe]');
  if (tastyContainer) {
    const result = extractTastyRecipes(tastyContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'tasty', ...result };
    }
  }

  // ── EasyRecipe Detection ──
  const easyRecipeContainer = doc.querySelector('.EasyRecipeType, [itemtype*="Recipe"]');
  if (easyRecipeContainer) {
    const result = extractEasyRecipe(easyRecipeContainer);
    if (result.ingredients.length > 0 || result.directions.length > 0) {
      return { type: 'easyrecipe', ...result };
    }
  }

  // ── JSON-LD Recipe Detection (Schema.org) ──
  const jsonldResult = extractJsonLdRecipe(doc);
  if (jsonldResult.ingredients.length > 0 || jsonldResult.directions.length > 0) {
    return { type: 'jsonld', ...jsonldResult };
  }

  // ── Semantic HTML + Microdata Detection ──
  const semanticResult = extractSemanticRecipe(doc);
  if (semanticResult.ingredients.length > 0 || semanticResult.directions.length > 0) {
    return { type: 'semantic', ...semanticResult };
  }

  // ── Common CSS pattern detection ──
  const cssResult = extractByCommonPatterns(doc);
  if (cssResult.ingredients.length > 0 || cssResult.directions.length > 0) {
    return { type: 'css-patterns', ...cssResult };
  }

  // No recognized plugin found
  return { type: null, title: '', ingredients: [], directions: [], imageUrl: '' };
}

/**
 * Extract recipe from WPRM (WP Recipe Maker) markup.
 * WPRM stores recipe data in data-wprm-recipe JSON attributes and semantic HTML.
 */
function extractWPRM(container) {
  const title = container.querySelector('.wprm-recipe-name, h2.wprm-recipe-name, [itemprop="name"]')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Extract ingredients from list items with proper class patterns
  for (const item of container.querySelectorAll('.wprm-recipe-ingredient, li[itemprop="recipeIngredient"]')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Extract directions from numbered steps
  for (const item of container.querySelectorAll('.wprm-recipe-instruction, li[itemprop="recipeInstructions"]')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Try to find image
  const imgEl = container.querySelector('img[itemprop="image"], .wprm-recipe-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from Tasty Recipes markup.
 * Tasty Recipes uses semantic HTML with microdata and CSS classes.
 */
function extractTastyRecipes(container) {
  const title = container.querySelector('h1[itemprop="name"], .tasty-recipes-title')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Tasty Recipes uses structured list items
  for (const item of container.querySelectorAll('[itemprop="recipeIngredient"], .tasty-recipe-ingredient')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Instructions are in divs/spans with itemprop
  for (const item of container.querySelectorAll('[itemprop="recipeInstructions"], .tasty-recipe-instructions li')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Try to find recipe image
  const imgEl = container.querySelector('img[itemprop="image"], .tasty-recipes-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from EasyRecipe markup (microdata based).
 * Uses schema.org itemtype and itemprop attributes.
 */
function extractEasyRecipe(container) {
  const title = container.querySelector('[itemprop="name"]')?.textContent.trim() || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // EasyRecipe wraps ingredients in divs with itemprop
  for (const item of container.querySelectorAll('[itemprop="recipeIngredient"], .ingredient')) {
    const text = item.textContent?.trim();
    if (text) {
      ingredients.push(text);
    }
  }

  // Instructions are in itemprop="recipeInstructions" or similar
  for (const item of container.querySelectorAll('[itemprop="recipeInstructions"], .recipe-instructions li')) {
    const text = item.textContent?.trim();
    if (text) {
      directions.push(text);
    }
  }

  // Image extraction
  const imgEl = container.querySelector('[itemprop="image"]');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || imgEl.getAttribute('content') || '';
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe from JSON-LD structured data (Schema.org Recipe type).
 * Searches for <script type="application/ld+json"> with @type: Recipe.
 */
function extractJsonLdRecipe(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent);
      const recipe = findRecipeInJson(data);
      if (recipe) {
        const result = normalizeJsonLdRecipe(recipe);
        if (result.ingredients.length > 0 || result.directions.length > 0) {
          return result;
        }
      }
    } catch { /* not valid JSON, skip */ }
  }

  return { title: '', ingredients: [], directions: [], imageUrl: '' };
}

/**
 * Recursively find Recipe object in JSON-LD data structure.
 * Handles nested @graph and arrays.
 */
function findRecipeInJson(obj) {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findRecipeInJson(item);
      if (found) return found;
    }
    return null;
  }

  const type = (obj['@type'] || '').toString().toLowerCase();
  if (type.includes('recipe')) return obj;

  if (obj['@graph']) {
    return findRecipeInJson(obj['@graph']);
  }

  return null;
}

/**
 * Normalize JSON-LD Recipe to standard format.
 * Handles various field names and structures.
 */
function normalizeJsonLdRecipe(recipe) {
  const title = recipe.name || recipe.title || '';
  const ingredients = [];
  const directions = [];
  let imageUrl = selectBestImage(recipe.image) || '';

  // Ingredients can be string array or objects with @type: RecipeIngredient
  if (recipe.recipeIngredient) {
    if (Array.isArray(recipe.recipeIngredient)) {
      for (const ing of recipe.recipeIngredient) {
        if (typeof ing === 'string') {
          ingredients.push(ing);
        } else if (ing.text) {
          ingredients.push(ing.text);
        }
      }
    }
  }

  // Instructions can be string array or objects with @type: RecipeInstructions
  if (recipe.recipeInstructions) {
    const instrs = Array.isArray(recipe.recipeInstructions) ? recipe.recipeInstructions : [recipe.recipeInstructions];
    for (const instr of instrs) {
      if (typeof instr === 'string') {
        directions.push(instr);
      } else if (instr.text) {
        directions.push(instr.text);
      } else if (instr.itemListElement && Array.isArray(instr.itemListElement)) {
        for (const item of instr.itemListElement) {
          if (item.text) directions.push(item.text);
        }
      }
    }
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe using semantic HTML structure.
 * Looks for <article>, <section> with aria-labels and semantic markup.
 */
function extractSemanticRecipe(doc) {
  const title = '';
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Find semantic containers for recipe sections
  const ingSection = doc.querySelector(
    'section[aria-label*="ingredient" i], section[aria-label*="ingredient" i], ' +
    'div[aria-label*="ingredient" i], .ingredients-section'
  );

  const dirSection = doc.querySelector(
    'section[aria-label*="instruction" i], section[aria-label*="direction" i], ' +
    'div[aria-label*="instruction" i], .directions-section'
  );

  // Extract ingredients from semantic container
  if (ingSection) {
    for (const item of ingSection.querySelectorAll('li, div[role="listitem"], p')) {
      const text = item.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        ingredients.push(text);
      }
    }
  }

  // Extract directions from semantic container
  if (dirSection) {
    for (const item of dirSection.querySelectorAll('li, div[role="listitem"], p')) {
      const text = item.textContent?.trim();
      if (text && text.length > 2) {
        directions.push(text);
      }
    }
  }

  return { title, ingredients, directions, imageUrl };
}

/**
 * Extract recipe by looking for common CSS class and attribute patterns.
 * Useful for non-standard recipe sites with custom markup.
 *
 * Patterns include:
 *   - recipe-ingredient, recipe-ingredient-item, ingredient-*
 *   - recipe-instruction, recipe-direction, recipe-step, instruction-*
 *   - ingredient-name, ingredient-amount, ingredient-unit
 */
function extractByCommonPatterns(doc) {
  const ingredients = [];
  const directions = [];
  let imageUrl = '';

  // Common ingredient selector patterns
  const ingredientSelectors = [
    '.recipe-ingredient',
    '.recipe-ingredient-item',
    '.ingredient-item',
    '[data-ingredient]',
    '.ingredients li',
    '.ingredient-list li',
    '[class*="ingredient"][class*="item"]',
  ];

  const directionSelectors = [
    '.recipe-instruction',
    '.recipe-step',
    '.instruction-item',
    '.recipe-direction',
    '[data-instruction]',
    '.instructions li',
    '.directions li',
    '.steps li',
    '[class*="instruction"][class*="item"]',
    '[class*="step"][class*="item"]',
  ];

  // Extract ingredients
  for (const selector of ingredientSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const text = el.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) {
        ingredients.push(text);
      }
    }
    if (ingredients.length > 0) break; // Stop after finding first pattern
  }

  // Extract directions
  for (const selector of directionSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      const text = el.textContent?.trim();
      if (text && text.length > 2) {
        directions.push(text);
      }
    }
    if (directions.length > 0) break; // Stop after finding first pattern
  }

  // Look for recipe image
  const imgEl = doc.querySelector('img[alt*="recipe" i], img[alt*="dish" i], .recipe-image img');
  if (imgEl) {
    imageUrl = imgEl.src || imgEl.dataset.src || '';
  }

  return { title: '', ingredients, directions, imageUrl };
}

/**
 * Parse a single ingredient line into structured components.
 *
 * Input:  "2 1/2 cups all-purpose flour"
 * Output: { quantity: "2 1/2", unit: "cups", name: "all-purpose flour" }
 *
 * Input:  "3 cloves garlic, minced"
 * Output: { quantity: "3", unit: "cloves", name: "garlic, minced" }
 *
 * Input:  "Salt and pepper to taste"
 * Output: { quantity: null, unit: null, name: "Salt and pepper to taste" }
 */
export function parseIngredientLine(text) {
  if (!text || text.trim().length === 0) {
    return { quantity: null, unit: null, name: '' };
  }

  text = text.trim();

  // Remove bullet points and list markers
  text = text.replace(/^[-•*▪▸►◦‣⁃✓✔]\s*/, '').trim();

  // Remove numbered list markers (1), 1., 1) etc.
  text = text.replace(/^\d+[.):\s-]\s*/, '').trim();

  // Match quantity + unit pattern
  // Quantity: decimal numbers, fractions (1/2, ⅓), unicode fractions
  const quantityUnitPattern = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s-]*?)\s+(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|lbs?|pounds?|grams?|g\b|kg|ml|liters?|litres?|pinch|pinches|dash|dashes|bunch|cloves?|cans?|jars?|packages?|pkg|sticks?|slices?|handful|handfuls|sprigs?|heads?|stalks?|fillets?|breasts?|thighs?|inches?|inch|pieces?|pcs?|counts?)\b/i;

  const match = text.match(quantityUnitPattern);
  if (match) {
    const quantity = match[1].trim();
    const unit = match[2].toLowerCase();
    const name = text.substring(match[0].length).trim();

    return {
      quantity: quantity || null,
      unit: unit || null,
      name: name || 'Unknown ingredient',
    };
  }

  // Try to match just quantity (for things like "3 chicken breasts")
  const quantityOnlyPattern = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s-]*?)\s+/;
  const qMatch = text.match(quantityOnlyPattern);
  if (qMatch) {
    const quantity = qMatch[1].trim();
    // Check if what follows is a food item (heuristic)
    const rest = text.substring(qMatch[0].length).trim();
    if (rest.length > 0 && /^[a-z]/i.test(rest)) {
      return {
        quantity: quantity || null,
        unit: null,
        name: rest,
      };
    }
  }

  // No quantity/unit detected — entire line is ingredient name
  return {
    quantity: null,
    unit: null,
    name: text,
  };
}

/**
 * Smart classification of text lines into ingredients vs directions.
 *
 * Combines multiple signals:
 *   1. CSS/class patterns from DOM elements
 *   2. Content heuristics (cooking verbs, measurements, structure)
 *   3. Section header detection
 *   4. Length and formatting analysis
 *
 * Returns: { ingredients: [...], directions: [...] }
 *   Each string is normalized and trimmed.
 */
export function smartClassifyLines(lines, sourceElement = null) {
  const ingredients = [];
  const directions = [];

  if (!lines || lines.length === 0) {
    return { ingredients, directions };
  }

  // Enhanced patterns with stronger signals
  const STRONG_INGREDIENT_PATTERN = /^([\d½¼¾⅓⅔⅛⅜⅝⅞][\d./\s]*\s+)?(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|bunch|cloves?|cans?|packages?|sticks?|slices?|handful|sprigs?|heads?|stalks?|fillets?|pieces?)\b/i;

  const DIRECTION_KEYWORD_START = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|freeze|thaw|melt|beat|cream|knead|roll|shape|form|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|shred|grate|crush|smash|pound|flatten|stuff|fill|top|finish|taste|adjust|reduce|deglaze|caramelize|brown|sear|steam|poach|microwave)\b/i;

  const NUMBERED_STEP = /^\d+[.):\s-]/;
  const BULLET_POINT = /^[-•*▪▸►◦‣⁃]/;

  let inIngredientsSection = false;
  let inDirectionsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    // Check for explicit section headers
    if (/^ingredients?s?:?\s*$|^you will need:?\s*$|^what you need:?\s*$/i.test(lower)) {
      inIngredientsSection = true;
      inDirectionsSection = false;
      continue;
    }

    if (/^(directions?|instructions?|method|steps?|preparation|how to.*):?\s*$/i.test(lower)) {
      inIngredientsSection = false;
      inDirectionsSection = true;
      continue;
    }

    // If we're in a known section, use that classification
    if (inIngredientsSection) {
      ingredients.push(trimmed);
      continue;
    }
    if (inDirectionsSection) {
      directions.push(trimmed);
      continue;
    }

    // Heuristic classification (no explicit section found yet)
    const hasStrongIngredientPattern = STRONG_INGREDIENT_PATTERN.test(trimmed);
    const hasDirectionKeyword = DIRECTION_KEYWORD_START.test(trimmed);
    const hasNumberedStep = NUMBERED_STEP.test(trimmed);
    const hasBulletPoint = BULLET_POINT.test(trimmed);
    const length = trimmed.length;

    // Strong signals
    if (hasStrongIngredientPattern && !hasDirectionKeyword) {
      ingredients.push(trimmed);
    } else if ((hasNumberedStep || hasDirectionKeyword) && length > 20) {
      directions.push(trimmed);
    } else if (hasBulletPoint && !hasDirectionKeyword && !hasNumberedStep) {
      // Bullets without clear direction signal — likely ingredients
      ingredients.push(trimmed);
    } else if (hasDirectionKeyword) {
      directions.push(trimmed);
    } else if (length > 60) {
      // Long lines without clear cooking signal are probably directions
      directions.push(trimmed);
    } else if (length < 50 && FOOD_RE.test(trimmed)) {
      // Short line with food keywords → ingredient
      ingredients.push(trimmed);
    } else if (hasNumberedStep) {
      directions.push(trimmed);
    } else {
      // Default: short unknown lines → ingredients, long ones → directions
      if (length < 50) {
        ingredients.push(trimmed);
      } else {
        directions.push(trimmed);
      }
    }
  }

  return { ingredients, directions };
}

/**
 * Automatically extract recipe from page content without requiring user interaction.
 *
 * Attempts extraction in order of confidence:
 *   1. Detect recipe plugin markup (WPRM, Tasty Recipes, etc.)
 *   2. Extract JSON-LD structured data
 *   3. Use smart heuristic classification on visible text
 *
 * This is suitable for:
 *   - Server-side processing (render Instagram posts automatically)
 *   - Client-side auto-extraction (without BrowserAssist button)
 *
 * Args:
 *   pageContent - { html, visibleText, imageUrls, sourceUrl }
 *   or just HTML string for backward compat
 *
 * Returns:
 *   { name, ingredients, directions, imageUrl, link, extractedVia }
 *   or null if nothing found
 */
export function extractWithBrowserAPI(pageContent) {
  let html, visibleText, imageUrls, sourceUrl;

  // Support both object and string input
  if (typeof pageContent === 'string') {
    html = pageContent;
    visibleText = '';
    imageUrls = [];
    sourceUrl = '';
  } else {
    html = pageContent.html || '';
    visibleText = pageContent.visibleText || '';
    imageUrls = pageContent.imageUrls || [];
    sourceUrl = pageContent.sourceUrl || '';
  }

  // ── Step 1: Try to detect recipe plugins/structured markup ──
  if (html) {
    const pluginResult = detectRecipePlugins(html);
    if (pluginResult.type && (pluginResult.ingredients.length > 0 || pluginResult.directions.length > 0)) {
      return {
        name: cleanTitle(pluginResult.title || 'Recipe'),
        ingredients: pluginResult.ingredients.length > 0
          ? pluginResult.ingredients
          : ['See recipe for ingredients'],
        directions: pluginResult.directions.length > 0
          ? pluginResult.directions
          : ['See recipe for directions'],
        imageUrl: pluginResult.imageUrl || (imageUrls[0] || ''),
        link: sourceUrl,
        extractedVia: `plugin-${pluginResult.type}`,
      };
    }
  }

  // ── Step 2: Try parseCaption on visible text (leverages existing heuristics) ──
  if (visibleText) {
    const parsed = parseCaption(visibleText);
    if (parsed.ingredients.length > 0 || parsed.directions.length > 0) {
      return {
        name: cleanTitle(parsed.title || 'Recipe'),
        ingredients: parsed.ingredients.length > 0
          ? parsed.ingredients
          : ['See recipe for ingredients'],
        directions: parsed.directions.length > 0
          ? parsed.directions
          : ['See recipe for directions'],
        imageUrl: imageUrls[0] || '',
        link: sourceUrl,
        extractedVia: 'caption-parsing',
      };
    }

    // ── Step 3: Use smart line classification as fallback ──
    const lines = visibleText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 2);

    if (lines.length > 0) {
      const classified = smartClassifyLines(lines);
      if (classified.ingredients.length > 0 || classified.directions.length > 0) {
        return {
          name: cleanTitle('Recipe'),
          ingredients: classified.ingredients.length > 0
            ? classified.ingredients
            : ['See recipe for ingredients'],
          directions: classified.directions.length > 0
            ? classified.directions
            : ['See recipe for directions'],
          imageUrl: imageUrls[0] || '',
          link: sourceUrl,
          extractedVia: 'smart-classification',
        };
      }
    }
  }

  // No recipe found
  return null;
}

