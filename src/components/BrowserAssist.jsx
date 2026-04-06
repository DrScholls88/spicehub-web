// src/components/BrowserAssist.jsx
// Updated with full 4-phase stepper for maximum interactivity and transparency

import React, { useState, useEffect } from 'react';
import { importRecipeFromUrlWithProgress } from '../lib/recipeParser.js';

export default function BrowserAssist({ url, onRecipeImported, onManualFallback }) {
  const [progress, setProgress] = useState([]);
  const [status, setStatus] = useState('idle');

  const addProgress = (step) => {
    setProgress(prev => [...prev, step]);
  };

  useEffect(() => {
    const runImport = async () => {
      setStatus('importing');
      setProgress([]);

      try {
        const result = await importRecipeFromUrlWithProgress(url, addProgress);

        if (result?._needsManualCaption) {
          onManualFallback(result.sourceUrl, result.bestImage);
          return;
        }

        onRecipeImported(result);
        setStatus('complete');
      } catch (err) {
        console.error(err);
        onManualFallback(url);
      }
    };

    runImport();
  }, [url]);

  return (
    <div className="browser-assist">
      <h3>Importing from Instagram…</h3>
      <div className="progress-stepper">
        {progress.map((step, i) => (
          <div key={i} className={`step ${step.step}`}>
            <span className="step-dot"></span>
            <span className="step-text">{step.message}</span>
          </div>
        ))}
      </div>

      {status === 'complete' && <p className="success">✅ Recipe ready!</p>}
    </div>
  );
}