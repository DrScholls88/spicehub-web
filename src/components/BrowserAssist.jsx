// src/components/BrowserAssist.jsx
// Corrected import path for your project structure (recipeParser.js is in src/)

import React, { useState, useEffect } from 'react';

// CORRECT IMPORT – recipeParser.js sits directly in src/
import { importRecipeFromUrlWithProgress } from '../recipeParser.js';

export default function BrowserAssist({ url, onRecipeImported, onManualFallback }) {
  const [progress, setProgress] = useState([]);
  const [status, setStatus] = useState('idle');

  const addProgress = (step) => {
    setProgress(prev => [...prev, step]);
  };

  useEffect(() => {
    if (!url) return;

    const runImport = async () => {
      setStatus('importing');
      setProgress([]);

      try {
        const result = await importRecipeFromUrlWithProgress(url, addProgress);

        if (result?._needsManualCaption === true) {
          onManualFallback?.(result.sourceUrl, result.bestImage);
          return;
        }

        onRecipeImported?.(result);
        setStatus('complete');
      } catch (err) {
        console.error('Import failed:', err);
        onManualFallback?.(url);
      }
    };

    runImport();
  }, [url]);

  return (
    <div className="browser-assist p-6 bg-white dark:bg-gray-900 rounded-xl shadow">
      <h3 className="text-xl font-semibold mb-6 text-center">Importing from Instagram</h3>
      
      <div className="progress-stepper space-y-4">
        {progress.length === 0 && (
          <div className="text-gray-500 text-center py-4">Starting import...</div>
        )}
        
        {progress.map((step, index) => (
          <div key={index} className={`step flex items-start gap-4 p-3 rounded-lg border-l-4 border-blue-500 bg-gray-50 dark:bg-gray-800 ${step.step || ''}`}>
            <div className="step-dot w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
              {index + 1}
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-white">{step.message}</div>
              {step.step && (
                <div className="text-xs text-gray-500 mt-0.5">Phase {step.step.replace('phase', '')}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {status === 'complete' && (
        <div className="mt-8 text-center text-green-600 font-medium">
          ✅ Recipe imported successfully!
        </div>
      )}
    </div>
  );
}