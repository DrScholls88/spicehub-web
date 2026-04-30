
$path = "c:\Users\bjgoe\Documents\Projects\spicehub_meal_spinner\spicehub-web\src\recipeParser.js"
$content = Get-Content -Path $path -Raw

# Replace importFromInstagram with a much cleaner version
$newFunc = @"
export async function importFromInstagram(url, onProgress = () => {}, { type = 'meal' } = {}) {
  const progress = (phase, status, msg) => onProgress(phase, status, msg);

  let capturedCaption = '';
  let capturedImageUrl = '';
  let capturedRawPageText = '';

  // Phase 1: Instagram embed page (Fast path)
  progress(1, 'running', 'Fetching Instagram caption...');
  try {
    const embedData = await extractInstagramEmbed(url);
    if (embedData?.caption) {
      capturedCaption = cleanSocialCaption(embedData.caption);
      progress(1, 'done', 'Caption found!');
    } else if (embedData?.rawPageText) {
      capturedRawPageText = embedData.rawPageText;
      progress(1, 'done', 'Post text captured');
    } else {
      progress(1, 'failed', 'Caption not found');
    }
    if (embedData?.imageUrl) capturedImageUrl = embedData.imageUrl;
  } catch {
    progress(1, 'failed', 'Embed fetch failed');
  }

  // Phase 3: Gemini AI structuring (The Always-Run Layer)
  const textForGemini = capturedCaption?.trim() || capturedRawPageText?.trim();
  
  if (textForGemini && textForGemini.length > 20) {
    progress(3, 'running', 'Structuring with Google AI...');
    try {
      const recipe = await captionToRecipe(textForGemini, { imageUrl: capturedImageUrl, sourceUrl: url, type });
      if (recipe && (recipe.ingredients?.length || recipe.directions?.length)) {
        progress(3, 'done', 'Recipe structured successfully!');
        return {
          ...recipe,
          imageUrl: capturedImageUrl || recipe.imageUrl,
          extractedVia: 'caption-ai',
          sourceUrl: url,
          importedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error('[SpiceHub] Gemini error:', err);
    }
    progress(3, 'failed', 'AI could not structure a recipe from this post');
  }

  // If we reach here, we need BrowserAssist to help the user
  return { _needsManualCaption: true, sourceUrl: url };
}
"@

$content = $content -replace '(?ms)export async function importFromInstagram\(.*?\}\n\nexport function detectImportType', ($newFunc + "`n`nexport function detectImportType")

Set-Content -Path $path -Value $content -Encoding UTF8
