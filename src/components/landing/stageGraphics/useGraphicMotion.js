import { useReducedMotion } from 'framer-motion';

/**
 * Shared reduced-motion gate for hero stage graphics.
 *
 * Each graphic (ImportGraphic, PlanGraphic, GroceryGraphic, CookGraphic)
 * is a small looping demo — pure decoration, no information is conveyed
 * only by the motion (every graphic's static end-state is legible on its
 * own: recipe card, filled day slots, sorted lanes, matched ingredients).
 * When the user has prefers-reduced-motion set, skip the loop and render
 * that end-state immediately instead of animating into it.
 *
 * @returns {boolean} true if graphics should skip motion and show the
 *   settled/final frame right away.
 */
export default function useReducedGraphicMotion() {
  return useReducedMotion();
}
