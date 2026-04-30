
$path = "c:\Users\bjgoe\Documents\Projects\spicehub_meal_spinner\spicehub-web\src\recipeParser.js"
$content = Get-Content -Path $path -Raw

# 1. Remove PROXIES and fetchHtmlViaProxy
$content = $content -replace 'const PROXIES = \[[\s\S]*?\];', '// PROXIES removed'
$content = $content -replace 'async function fetchHtmlViaProxy\(url, timeoutMs = 15000\) \{[\s\S]*?\n\}', '// fetchHtmlViaProxy removed'

# 2. Update fetchHtmlViaProxy calls to fetchHtmlViaProxyFromApi
$content = $content -replace 'fetchHtmlViaProxy\(', 'fetchHtmlViaProxyFromApi('

# 3. Remove detectServer
$content = $content -replace 'async function detectServer\(\) \{[\s\S]*?\n\}', '// detectServer removed'

# 4. Remove tryVideoExtraction
$content = $content -replace 'export async function tryVideoExtraction\([\s\S]*?\n\}', '// tryVideoExtraction removed'

# 5. Remove extractInstagramAgent
$content = $content -replace 'export async function extractInstagramAgent\([\s\S]*?\n\}', '// extractInstagramAgent removed'

Set-Content -Path $path -Value $content -Encoding UTF8
