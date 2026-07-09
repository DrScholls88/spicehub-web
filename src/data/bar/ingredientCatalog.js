// ingredientCatalog.js — a big curated list of bar ingredients the user can
// tap to stock their My Bar shelf. Names are plain strings; the sprite for each
// is derived deterministically by barSprites.spriteSpec (offline, zero-asset).
// Grouped by category for the catalog UI.

export const INGREDIENT_CATALOG = [
  {
    key: 'spirits',
    label: 'Spirits',
    emoji: '🥃',
    items: [
      'Vodka', 'Gin', 'London Dry Gin', 'Old Tom Gin', 'Plymouth Gin',
      'White Rum', 'Dark Rum', 'Spiced Rum', 'Aged Rum', 'Cachaça',
      'Blanco Tequila', 'Reposado Tequila', 'Añejo Tequila', 'Mezcal',
      'Bourbon', 'Rye Whiskey', 'Scotch', 'Irish Whiskey', 'Tennessee Whiskey',
      'Japanese Whisky', 'Cognac', 'Brandy', 'Armagnac', 'Pisco', 'Calvados',
      'Absinthe', 'Aquavit', 'Grappa', 'Soju',
    ],
  },
  {
    key: 'liqueurs',
    label: 'Liqueurs',
    emoji: '🍾',
    items: [
      'Triple Sec', 'Cointreau', 'Grand Marnier', 'Blue Curaçao', 'Orange Liqueur',
      'Amaretto', 'Kahlúa', 'Coffee Liqueur', 'Baileys', 'Irish Cream',
      'Aperol', 'Campari', 'Green Chartreuse', 'Yellow Chartreuse', 'Frangelico',
      'Chambord', 'St-Germain', 'Elderflower Liqueur', 'Maraschino Liqueur',
      'Limoncello', 'Sambuca', 'Drambuie', 'Bénédictine', 'Midori', 'Melon Liqueur',
      'Peach Schnapps', 'Butterscotch Schnapps', 'Crème de Cassis', 'Crème de Menthe',
      'Crème de Violette', 'Falernum', 'Amaro', 'Fernet', 'Sloe Gin',
    ],
  },
  {
    key: 'fortified',
    label: 'Vermouth & Fortified',
    emoji: '🍷',
    items: [
      'Dry Vermouth', 'Sweet Vermouth', 'Blanc Vermouth', 'Lillet Blanc',
      'Cocchi Americano', 'Dry Sherry', 'Cream Sherry', 'Ruby Port', 'Tawny Port',
      'Madeira', 'Dubonnet',
    ],
  },
  {
    key: 'wine_beer',
    label: 'Wine & Beer',
    emoji: '🍻',
    items: [
      'Champagne', 'Prosecco', 'Sparkling Wine', 'Cava', 'White Wine', 'Red Wine',
      'Rosé', 'Lager', 'Pilsner', 'IPA', 'Stout', 'Pale Ale', 'Hard Cider',
    ],
  },
  {
    key: 'bitters',
    label: 'Bitters',
    emoji: '💧',
    items: [
      'Angostura Bitters', 'Orange Bitters', "Peychaud's Bitters",
      'Chocolate Bitters', 'Aromatic Bitters', 'Celery Bitters',
    ],
  },
  {
    key: 'mixers',
    label: 'Mixers & Soda',
    emoji: '🥤',
    items: [
      'Soda Water', 'Club Soda', 'Tonic Water', 'Cola', 'Lemon-Lime Soda',
      'Ginger Ale', 'Ginger Beer', 'Sparkling Water', 'Energy Drink', 'Coconut Water',
    ],
  },
  {
    key: 'juices',
    label: 'Juices',
    emoji: '🧃',
    items: [
      'Lime Juice', 'Lemon Juice', 'Orange Juice', 'Grapefruit Juice',
      'Pineapple Juice', 'Cranberry Juice', 'Tomato Juice', 'Apple Juice',
      'Pomegranate Juice', 'Passion Fruit Juice', 'Mango Juice',
    ],
  },
  {
    key: 'syrups',
    label: 'Syrups & Sweet',
    emoji: '🍯',
    items: [
      'Simple Syrup', 'Demerara Syrup', 'Honey Syrup', 'Agave Nectar', 'Grenadine',
      'Orgeat', 'Maple Syrup', 'Vanilla Syrup', 'Cinnamon Syrup', 'Raspberry Syrup',
      'Elderflower Cordial',
    ],
  },
  {
    key: 'fruit',
    label: 'Citrus & Fruit',
    emoji: '🍋',
    items: [
      'Lime', 'Lemon', 'Orange', 'Grapefruit', 'Blood Orange', 'Pineapple',
      'Strawberry', 'Raspberry', 'Blackberry', 'Blueberry', 'Cherry',
      'Maraschino Cherry', 'Cucumber', 'Watermelon', 'Peach', 'Apple', 'Pear',
    ],
  },
  {
    key: 'herbs',
    label: 'Herbs & Garnish',
    emoji: '🌿',
    items: [
      'Mint', 'Basil', 'Rosemary', 'Thyme', 'Sage', 'Cilantro', 'Lavender',
      'Olive', 'Cocktail Onion', 'Celery', 'Jalapeño', 'Ginger', 'Lemongrass',
      'Edible Flower',
    ],
  },
  {
    key: 'dairy',
    label: 'Dairy & Egg',
    emoji: '🥚',
    items: [
      'Egg White', 'Egg Yolk', 'Whole Egg', 'Heavy Cream', 'Half and Half',
      'Coconut Cream', 'Milk', 'Aquafaba',
    ],
  },
  {
    key: 'pantry',
    label: 'Pantry & Spice',
    emoji: '🧂',
    items: [
      'Sugar', 'Superfine Sugar', 'Brown Sugar', 'Salt', 'Sea Salt', 'Nutmeg',
      'Cinnamon', 'Black Pepper', 'Cayenne', 'Hot Sauce', 'Worcestershire Sauce',
      'Coffee', 'Espresso', 'Cold Brew', 'Green Tea', 'Matcha', 'Vanilla Extract', 'Ice',
    ],
  },
];

// Flat list of every catalog name (handy for search / counts / tests).
export const ALL_CATALOG_ITEMS = INGREDIENT_CATALOG.flatMap((c) => c.items);

export default INGREDIENT_CATALOG;
