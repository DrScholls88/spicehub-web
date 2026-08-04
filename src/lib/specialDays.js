// Special "non-meal" day options — built-in quick-assign tags for planner days
// (Eat Out, Leftovers, Pizza Night, etc.). Extracted from App.jsx so it can be
// shared with useRotationEngine (setDaySpecial) without a hook-importing-from-
// page-component circular dependency.
export const SPECIAL_DAYS = [
  { id: '__eat_out__',        name: 'Eat Out',          icon: '🍽️' },
  { id: '__leftovers__',      name: 'Leftovers',        icon: '📦' },
  { id: '__dealers_choice__', name: "Dealer's Choice",   icon: '🎲' },
  { id: '__pizza__',          name: 'Pizza',             icon: '🍕' },
  { id: '__grill__',          name: 'Grill Night',       icon: '🔥' },
  { id: '__tacos__',          name: 'Tacos',             icon: '🌮' },
  { id: '__nachos__',         name: 'Nachos',            icon: '🧀' },
  { id: '__pasta__',          name: 'Pasta Night',       icon: '🍝' },
  { id: '__soup__',           name: 'Soup Night',        icon: '🍲' },
  { id: '__sandwiches__',     name: 'Sandwiches',        icon: '🥪' },
  { id: '__salad__',          name: 'Salad Night',       icon: '🥗' },
  { id: '__breakfast__',      name: 'Breakfast for Dinner', icon: '🥞' },
  { id: '__skip__',           name: 'No Plan',           icon: '⏭️' },
];
