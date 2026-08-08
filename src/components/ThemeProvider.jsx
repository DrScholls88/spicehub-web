import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import { hapticLight } from '../haptics';

// Create the theme context
const ThemeContext = createContext(undefined);

// Theme Provider Component
const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState('auto');
  const [accent, setAccentState] = useState('default');
  const [isDark, setIsDark] = useState(false);

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('spicehub_theme') || 'auto';
    const savedAccent = localStorage.getItem('spicehub_accent') || 'default';

    setThemeState(savedTheme);
    setAccentState(savedAccent);
  }, []);

  // Determine if dark mode is active (resolves 'auto' mode)
  useEffect(() => {
    const updateDarkMode = () => {
      let dark = false;

      if (theme === 'dark') {
        dark = true;
      } else if (theme === 'auto') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        dark = mediaQuery.matches;
      }

      setIsDark(dark);
    };

    updateDarkMode();

    // Listen for system theme changes if in auto mode
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateDarkMode);
      return () => mediaQuery.removeEventListener('change', updateDarkMode);
    }
  }, [theme]);

  // Apply theme to DOM + set data-system-dark for auto mode CSS selectors
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Set data-system-dark so CSS selector [data-theme="auto"][data-system-dark="true"] works
    document.documentElement.setAttribute('data-system-dark', String(isDark && theme === 'auto'));
  }, [theme, isDark]);

  // Apply accent to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  // Handle theme change
  const handleSetTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('spicehub_theme', newTheme);
  }, []);

  // Handle accent change
  const handleSetAccent = useCallback((newAccent) => {
    setAccentState(newAccent);
    localStorage.setItem('spicehub_accent', newAccent);
  }, []);

  const value = {
    theme,
    setTheme: handleSetTheme,
    accent,
    setAccent: handleSetAccent,
    isDark,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme context
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Theme Settings Component — visual swatch pickers (color circles, not text
// buttons). See SettingsPlan.md §2 "Visual Theme Swatches": upgrade the
// picker itself, skip the "mini app mockup" idea (bad scope-to-payoff ratio
// for a settings row).
export const ThemeSettings = () => {
  const { theme, setTheme, accent, setAccent } = useTheme();

  const themes = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'auto', label: 'Auto' },
  ];

  const accents = [
    { id: 'default', label: 'Default' },
    { id: 'autumn', label: 'Autumn' },
    { id: 'spring', label: 'Spring' },
    { id: 'summer', label: 'Summer' },
    { id: 'winter', label: 'Winter' },
  ];

  const pick = (setter, id) => {
    hapticLight(); // no-op on iOS (no navigator.vibrate) — the stg-pulse
    // scale-down on :active is the universal fallback, see App.css
    setter(id);
  };

  return (
    <div className="ts-settings-container">
      <div className="ts-section">
        <h3 className="ts-section-title">Theme</h3>
        <div className="ts-swatch-row">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ts-swatch ts-swatch-${t.id} stg-pulse ${theme === t.id ? 'ts-swatch-active' : ''}`}
              onClick={() => pick(setTheme, t.id)}
              aria-pressed={theme === t.id}
              aria-label={t.label}
            >
              <span className="ts-swatch-circle" />
              <span className="ts-swatch-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ts-section">
        <h3 className="ts-section-title">Seasonal Accent</h3>
        <div className="ts-swatch-row ts-swatch-row-scroll">
          {accents.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`ts-swatch stg-pulse ${accent === a.id ? 'ts-swatch-active' : ''}`}
              onClick={() => pick(setAccent, a.id)}
              aria-pressed={accent === a.id}
              aria-label={a.label}
            >
              <span className={`ts-swatch-circle ts-accent-${a.id}`} />
              <span className="ts-swatch-label">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThemeProvider;
