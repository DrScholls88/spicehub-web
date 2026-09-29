import { ShoppingCart, ChevronRight, X } from 'lucide-react';

// Shown on Plan after a Home Plan Card spin (spec 2026-09-28 A1): the grocery
// list the spin just built, and the nudge to swap a starter for your own recipe.
export default function MakeItYoursCard({ groceryCount = 0, onOpenGrocery, onImport, onDismiss }) {
  return (
    <div className="miy">
      <button type="button" className="miy-grocery" onClick={onOpenGrocery}>
        <ShoppingCart size={18} strokeWidth={2} aria-hidden="true" />
        <span>Grocery list ready · {groceryCount} item{groceryCount === 1 ? '' : 's'}</span>
        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      <section className="miy-card" aria-labelledby="miy-title">
        <button type="button" className="miy-close" onClick={onDismiss} aria-label="Dismiss Make it yours">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <h3 id="miy-title" className="miy-title">Make it yours</h3>
        <p className="miy-body">Saved a recipe on Instagram or TikTok? Swap one of these for it.</p>
        <button type="button" className="miy-btn" onClick={onImport}>Import a recipe</button>
      </section>
    </div>
  );
}
