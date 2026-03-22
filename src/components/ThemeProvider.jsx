import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';

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

  // Apply theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

// Theme Settings Component
export const ThemeSettings = () => {
  const { theme, setTheme, accent, setAccent } = useTheme();

  const themes = [
    { id: 'light', label: 'Light', emoji: '☀️' },
    { id: 'dark', label: 'Dark', emoji: '🌙' },
    { id: 'auto', label: 'Auto', emoji: '🔄' },
  ];

  const accents = [
    { id: 'default', label: 'Default', emoji: '🎨' },
    { id: 'autumn', label: 'Autumn', emoji: '🍂' },
    { id: 'spring', label: 'Spring', emoji: '🌸' },
    { id: 'summer', label: 'Summer', emoji: '☀️' },
    { id: 'winter', label: 'Winter', emoji: '❄️' },
  ];

  return (
    <div className="ts-settings-container">
      <div className="ts-section">
        <h3 className="ts-section-title">Theme</h3>
        <div className="ts-button-group">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`ts-button ts-theme-button ${theme === t.id ? 'ts-active' : ''}`}
              onClick={() => setTheme(t.id)}
              aria-pressed={theme === t.id}
              title={t.label}
            >
              <span className="ts-emoji">{t.emoji}</span>
              <span className="ts-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ts-section">
        <h3 className="ts-section-title">Seasonal Accent</h3>
        <div className="ts-button-group">
          {accents.map((a) => (
            <button
              key={a.id}
              className={`ts-button ts-accent-button ${accent === a.id ? 'ts-active' : ''}`}
              onClick={() => setAccent(a.id)}
              aria-pressed={accent === a.id}
              title={a.label}
            >
              <span className="ts-emoji">{a.emoji}</span>
              <span className="ts-label">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ThemeProvider;
