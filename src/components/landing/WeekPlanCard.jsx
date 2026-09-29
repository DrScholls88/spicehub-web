import React from 'react';
import { Dices } from 'lucide-react';
import { DOW_SHORT } from '../../lib/landingHelpers.js';

// Home Plan Card (spec 2026-09-28 A1/A3). Presentation only: LandingPage
// decides the state with getPlanCardState() and passes the handlers.
export default function WeekPlanCard({ plan, days = [], onSpin, onOpenMeals, onImport, onAddStarter }) {
  const { state, needed = 0, pool } = plan || {};
  if (!state || state === 'hidden') return null;

  let headline = "Let's plan your week";
  let body = 'One spin fills the empty days this week with dinners and builds your grocery list.';
  let primary = { label: 'Spin my week', onClick: onSpin, icon: true };
  let secondary = null;

  if (state === 'loading') {
    body = 'Getting your recipes ready…';
    primary = { ...primary, disabled: true };
  } else if (state === 'emptyLibrary') {
    headline = 'Get your first recipes in';
    body = 'Import one from a link or photo, or start with a pack of starter dinners.';
    primary = { label: 'Import a recipe', onClick: onImport };
    secondary = { label: 'Add starter pack', onClick: onAddStarter };
  } else if (state === 'rotationShort' && pool === 'rotation') {
    body = `Add ${needed} more to The Rotation to spin. The spinner only picks from meals in The Rotation.`;
    primary = { label: 'Open Meals', onClick: onOpenMeals };
  } else if (state === 'rotationShort') {
    body = `Add ${needed} more recipe${needed === 1 ? '' : 's'} to spin a week.`;
    primary = { label: 'Import a recipe', onClick: onImport };
    secondary = { label: 'Open Meals', onClick: onOpenMeals };
  }

  return (
    <section className="wpc" aria-labelledby="wpc-title">
      <div className="wpc-label">This week</div>
      <h2 id="wpc-title" className="wpc-title">{headline}</h2>
      <p className="wpc-body" aria-live="polite">{body}</p>
      <div className="wpc-days" aria-hidden="true">
        {days.map(({ date }) => (
          <span key={date.toDateString()} className="wpc-day">{DOW_SHORT[date.getDay()]}</span>
        ))}
      </div>
      <div className="wpc-actions">
        <button
          type="button"
          className="wpc-btn"
          onClick={primary.onClick}
          disabled={!!primary.disabled}
        >
          {primary.icon && <Dices size={18} strokeWidth={2} aria-hidden="true" />}
          {primary.label}
        </button>
        {secondary && (
          <button type="button" className="wpc-btn wpc-btn-secondary" onClick={secondary.onClick}>
            {secondary.label}
          </button>
        )}
      </div>
    </section>
  );
}
