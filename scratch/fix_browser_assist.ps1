
$path = "c:\Users\bjgoe\Documents\Projects\spicehub_meal_spinner\spicehub-web\src\components\BrowserAssist.jsx"
$content = Get-Content -Path $path -Raw

# Fix React import
if ($content -notmatch 'import \{.*useState.*\} from ''react''') {
    $content = "import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';`n" + $content
}

# Fix recipeParser imports
$parserImports = 'import \{.*?\} from ''\.\.\/recipeParser'';?'
# Using a simpler regex that doesn't rely on (?ms) if possible or being very careful
$newImports = @"
import { 
  extractRecipeFromDOM, 
  parseCaption, 
  extractWithBrowserAPI, 
  detectRecipePlugins, 
  isSocialMediaUrl, 
  getSocialPlatform, 
  scoreExtractionConfidence, 
  structureWithAI, 
  captionToRecipe, 
  cleanSocialCaption, 
  isCaptionWeak, 
  smartClassifyLines, 
  isWeakResult, 
  parseRecipeHybrid, 
  parseVisualJSON,
  importRecipeFromUrl
} from '../recipeParser';
"@

# Perform replacement for imports
# Since it's multiline, we'll use the -replace with a pattern that covers multiple lines
$content = [regex]::Replace($content, 'import \{[\s\S]*?\} from ''\.\.\/recipeParser'';', $newImports)

# Fix UI labels using a safer pattern
$content = $content -replace 'Extract'', ''#4CAF50', "Download Recipe', '#4CAF50"

Set-Content -Path $path -Value $content -Encoding UTF8
