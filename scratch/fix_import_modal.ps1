
$path = "c:\Users\bjgoe\Documents\Projects\spicehub_meal_spinner\spicehub-web\src\components\ImportModal.jsx"
$content = Get-Content -Path $path -Raw

# Remove any existing confirmImport functions
$content = $content -replace '(?ms)const confirmImport = \(\) => \{.*?^\s*\}\s*;', ''

# Insert the correct one
$insertionPoint = 'const handleDragStart ='
$correctFunction = @"
  const confirmImport = () => {
    if (!preview) return;
    const valid = preview.filter(m =>
      m && (m.name || m._isAddendum || (m.ingredients?.length > 0) || (m.directions?.length > 0))
    );
    if (!valid.length) return;

    onImport(valid.map(m => {
      const ings = m.ingredients?.length ? m.ingredients : [];
      const dirs = m.directions?.length ? m.directions : [];
      
      const structured = (m.ingredients_structured && m.directions_structured)
        ? {} 
        : buildStructuredFields(ings, dirs);

      const recipeObj = {
        ...m,
        ...structured,
        name: m.name || (m._isAddendum ? (m._addendumLabel || 'Side Dish') : 'Untitled Recipe'),
        ingredients: ings,
        directions: dirs,
        notes: m.notes || '',
        importedAt: m.importedAt || new Date().toISOString(),
      };

      recipeObj.description = renderRecipe(recipeObj, 'markdown');
      return recipeObj;
    }));
  };

"@

$content = $content.Replace($insertionPoint, $correctFunction + "`n  " + $insertionPoint)

Set-Content -Path $path -Value $content -Encoding UTF8
