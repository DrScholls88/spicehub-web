import { describe, it, expect } from 'vitest';
import { detectKindHeuristic } from '../recipeSchema.js';

// Phase 1 / I-4 / 1.5 (bar-library-parity-plan-2026-08-07.md) —
// detectKindHeuristic recalibration. Pins the two real false-negative classes
// that were misclassifying cocktail captions as meals, plus a hard-trigger
// short-circuit, without regressing genuine meal or zero-spirit mocktail cases.

describe('detectKindHeuristic — cocktail false negatives', () => {
  it('classifies an espresso martini as a drink (spirit + liqueur + action + glass, baseline case)', () => {
    const caption = `
      Espresso Martini
      2 oz vodka, 1 oz kahlua, 1 shot fresh espresso, 0.5 oz simple syrup.
      Shake hard with ice and double strain into a chilled coupe glass.
      Garnish with three coffee beans.
    `;
    expect(detectKindHeuristic(caption)).toBe('drink');
  });

  it('does not let a house simple-syrup "simmer" step flip a cocktail to meal (scoped penalty, no action words)', () => {
    // Deliberately avoids COCKTAIL_ACTIONS/DRINK_METHODS words so this pins the
    // scoped meal-signal penalty specifically, not the hard trigger below.
    const caption = `
      Whiskey Highball
      2oz whiskey, honey syrup (simmer honey and water until dissolved), soda water.
      Serve in a highball glass.
    `;
    expect(detectKindHeuristic(caption)).toBe('drink');
  });

  it('classifies a hot toddy as a drink even with a "boil" meal-signal word (hard trigger)', () => {
    const caption = `
      Hot Toddy
      Bring water to a boil. Stir 2 oz bourbon, 1 tbsp honey and a squeeze of
      lemon into a mug, top with the hot water, garnish with a cinnamon stick.
    `;
    expect(detectKindHeuristic(caption)).toBe('drink');
  });

  it('classifies a zero-spirit mocktail as a drink via glass + action + units', () => {
    const caption = `
      Virgin Mojito
      2 oz lime juice, 1 oz simple syrup, mint leaves, soda water.
      Muddle mint and lime in a highball glass, top with soda water,
      garnish with a mint sprig.
    `;
    expect(detectKindHeuristic(caption)).toBe('drink');
  });

  it('still classifies a genuine dinner recipe as a meal (regression guard)', () => {
    const caption = `
      Sheet Pan Chicken and Broccoli
      4 chicken thighs, 2 cups broccoli florets, olive oil, salt and pepper.
      Preheat oven to 425F. Roast chicken and broccoli for 25 minutes until
      golden and cooked through.
    `;
    expect(detectKindHeuristic(caption)).toBe('meal');
  });

  it('still classifies a syrup-heavy dessert with no spirit as a meal (syrup exception requires a spirit/liqueur)', () => {
    const caption = `
      Pancakes with Maple Syrup
      2 cups flour, 2 eggs, milk, maple syrup.
      Preheat a griddle, simmer the batter briefly, bake if using the oven method.
    `;
    expect(detectKindHeuristic(caption)).toBe('meal');
  });
});
