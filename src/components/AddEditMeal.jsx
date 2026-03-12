import { useState } from 'react';
import { parseFromUrl, isSocialMediaUrl, getSocialPlatform } from '../recipeParser';

const MEAL_CATEGORIES = ['Dinners', 'Breakfasts', 'Lunches', 'Desserts', 'Sides', 'Tailgate', 'Snacks'];

export default function AddEditMeal({
  meal,
  onSave,
  onClose,
  title,             // override modal title
  placeholder = '🍽️', // icon shown in import toolbar
  ingredientLabel = 'Ingredients',
  directionsLabel = 'Directions',
  categories,        // if provided, show category picker
}) {
  const isEdit = !!(meal && meal.id);
  const isMealMode = placeholder !== '🍹';
  const [name, setName] = useState(meal?.name || '');
  const [category, setCategory] = useState(meal?.category || (isMealMode ? 'Dinners' : ''));
  const [ingredients, setIngredients] = useState(meal?.ingredients?.length ? meal.ingredients : ['']);
  const [directions, setDirections] = useState(meal?.directions?.length ? meal.directions : ['']);
  const [link, setLink] = useState(meal?.link || '');
  const [imageUrl, setImageUrl] = useState(meal?.imageUrl || '');

  const [importUrl, setImportUrl] = useState('');
  const [showImportUrl, setShowImportUrl] = useState(false);
  const [socialDetected, setSocialDetected] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const applyParsed = (result) => {
    if (!result || result._error) return false;
    if (result.name && result.name !== 'Imported Recipe') setName(result.name);
    if (result.ingredients?.length) setIngredients(result.ingredients);
    if (result.directions?.length) setDirections(result.directions);
    if (result.link) setLink(result.link);
    if (result.imageUrl) setImageUrl(result.imageUrl);
    return true;
  };

  const handleUrlChange = (e) => {
    const val = e.target.value;
    setImportUrl(val);
    setError('');
    if (isSocialMediaUrl(val)) {
      setSocialDetected({ platform: getSocialPlatform(val) });
    } else {
      setSocialDetected(null);
    }
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;

    setImporting(true);
    setError('');
    try {
      const result = await parseFromUrl(importUrl.trim());
      if (!result) {
        setError('Could not extract recipe from that URL. The site may block automated access.');
      } else if (result._error) {
        setLink(importUrl.trim());
        if (result.reason === 'login-wall') {
          setError('This post requires login. You can still add the meal manually below.');
        } else {
          setError(`Could not extract from ${result.platform || 'this site'}. Please make sure the server is running.`);
        }
      } else {
        if (applyParsed(result)) {
          setShowImportUrl(false);
        }
      }
    } catch (e) {
      setError('Import failed: ' + e.message);
    }
    setImporting(false);
  };

  const handleSave = () => {
    if (!name.trim()) { setError('Meal name is required.'); return; }
    const data = {
      ...(isEdit ? { id: meal.id } : {}),
      name: name.trim(),
      ...(isMealMode && category ? { category } : {}),
      ingredients: ingredients.filter(i => i.trim()).length ? ingredients.filter(i => i.trim()) : ['No ingredients listed'],
      directions: directions.filter(d => d.trim()).length ? directions.filter(d => d.trim()) : ['No directions listed'],
      link: link.trim(),
      imageUrl: imageUrl.trim(),
    };
    onSave(data);
  };

  const updateList = (setter, idx, val) => setter(prev => prev.map((v, i) => i === idx ? val : v));
  const addToList = (setter) => setter(prev => [...prev, '']);
  const removeFromList = (setter, idx) => setter(prev => prev.filter((_, i) => i !== idx));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title || (isEdit ? '✏️ Edit Meal' : '➕ Add New Meal')}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-bar">{error}</div>}

        {/* ── Import toolbar ── */}
        {showImportUrl && <div className="import-buttons">
          <button
            className="btn-small active-toggle"
            onClick={() => { setShowImportUrl(false); setError(''); }}>
            ✕ Close Import
          </button>
        </div>}

        {/* ── URL import panel ── */}
        {showImportUrl && (
          <div className="import-section">
            {socialDetected ? (
              <div className="social-guide compact">
                <div className="social-guide-header">
                  <span className="social-badge">{socialDetected.platform}</span>
                  <span>Extracting recipe...</span>
                </div>
                <p className="help-text">
                  The app will automatically extract the recipe from {socialDetected.platform}.
                  If extraction fails, you can manually fill in the details below.
                </p>
              </div>
            ) : (
              <>
                <p className="help-text">Paste a recipe blog URL. Works great on AllRecipes, Food Network, NYT Cooking, Serious Eats, etc.</p>
                <input
                  type="url"
                  placeholder="https://www.allrecipes.com/recipe/..."
                  value={importUrl}
                  onChange={handleUrlChange}
                  className="full-width"
                  onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
                />
                <button className="btn-primary" onClick={handleImportUrl} disabled={importing}>
                  {importing ? '⏳ Importing...' : '📥 Import'}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Form fields ── */}
        <div className="form-scroll">
          <div className="form-group">
            <label>Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={placeholder === '🍹' ? 'e.g. Classic Margarita' : 'e.g. Chicken Parmesan'} />
          </div>
          {/* Category picker (meals only) */}
          {isMealMode && (
            <div className="form-group">
              <label>Category</label>
              <div className="category-picker">
                {(categories || MEAL_CATEGORIES).map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`meal-cat-chip${category === c ? ' active' : ''}`}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>Recipe Link</label>
            <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." />
          </div>
          <div className="form-group">
            <label>Image URL</label>
            <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
            {imageUrl && <img src={imageUrl} alt="Preview" className="image-preview" onError={e => { e.target.style.display = 'none'; }} />}
          </div>

          <div className="form-group">
            <label>{ingredientLabel}</label>
            {ingredients.map((ing, i) => (
              <div key={i} className="list-input-row">
                <input type="text" value={ing} onChange={e => updateList(setIngredients, i, e.target.value)} placeholder={`Ingredient ${i + 1}`} />
                {ingredients.length > 1 && <button className="btn-icon small danger" onClick={() => removeFromList(setIngredients, i)}>✕</button>}
              </div>
            ))}
            <button className="btn-small" onClick={() => addToList(setIngredients)}>+ Add Ingredient</button>
          </div>

          <div className="form-group">
            <label>{directionsLabel}</label>
            {directions.map((dir, i) => (
              <div key={i} className="list-input-row">
                <textarea
                  value={dir}
                  onChange={e => updateList(setDirections, i, e.target.value)}
                  placeholder={`Step ${i + 1}...`}
                  rows={2}
                />
                {directions.length > 1 && <button className="btn-icon small danger" onClick={() => removeFromList(setDirections, i)}>✕</button>}
              </div>
            ))}
            <button className="btn-small" onClick={() => addToList(setDirections)}>+ Add Step</button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>💾 {isEdit ? 'Save Changes' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
