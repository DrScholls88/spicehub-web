// ingredientCatalog.js — a massive, sectioned catalog of kitchen/pantry
// ingredients the user can browse and tap to track as "Fresh" in the Pantry.
// Mirrors src/data/bar/ingredientCatalog.js (same shape, same offline/
// zero-asset sprite approach via barSprites.spriteSpec — no network, no
// images). Names are plain display strings; PantryMode lowercases them on
// add, same as typing them into "Add something fresh…".
//
// Deliberately does NOT repeat any KITCHEN_STAPLES name (see
// lib/pantryDomain.js) — those already have a dedicated, permanent home in
// the Staples Vault. This catalog is the "massively expanded" browse view
// for everything else: produce, proteins, dairy, and pantry goods that
// aren't assumed permanently in stock. Heavy vegetarian/vegan coverage
// throughout, continuing the 2026-07-12 pantry expansion work.

export const INGREDIENT_CATALOG = [
  {
    key: 'produce_veg',
    label: 'Vegetables',
    emoji: '🥬',
    items: [
      'Spinach', 'Baby Spinach', 'Kale', 'Arugula', 'Romaine Lettuce', 'Iceberg Lettuce',
      'Butter Lettuce', 'Swiss Chard', 'Collard Greens', 'Bok Choy', 'Watercress',
      'Broccoli', 'Broccolini', 'Brussels Sprouts', 'Cauliflower', 'Purple Cauliflower',
      'Cabbage', 'Red Cabbage', 'Napa Cabbage', 'Carrots', 'Baby Carrots', 'Parsnips',
      'Beets', 'Golden Beets', 'Radishes', 'Turnips', 'Rutabaga', 'Celery', 'Celery Root',
      'Fennel', 'Asparagus', 'Green Beans', 'Snap Peas', 'Snow Peas', 'Okra',
      'Bell Peppers', 'Red Bell Pepper', 'Poblano Pepper', 'Serrano Pepper', 'Habanero',
      'Zucchini', 'Yellow Squash', 'Butternut Squash', 'Acorn Squash', 'Spaghetti Squash',
      'Pumpkin', 'Cucumber', 'English Cucumber', 'Tomatoes', 'Cherry Tomatoes',
      'Roma Tomatoes', 'Heirloom Tomatoes', 'Red Onion', 'Yellow Onion',
      'Sweet Onion', 'Shallots', 'Leeks', 'Scallions', 'Ginger', 'Corn',
      'Mushrooms', 'Cremini Mushrooms', 'Shiitake Mushrooms', 'Portobello Mushroom',
      'Oyster Mushrooms', 'Potatoes', 'Sweet Potatoes', 'Yukon Gold Potatoes',
      'Fingerling Potatoes', 'Avocado', 'Artichoke', 'Jicama', 'Eggplant',
    ],
  },
  {
    key: 'produce_fruit',
    label: 'Fruit',
    emoji: '🍎',
    items: [
      'Apples', 'Granny Smith Apples', 'Bananas', 'Oranges', 'Blood Orange',
      'Grapefruit', 'Lemons', 'Limes', 'Mandarins', 'Clementines', 'Grapes',
      'Red Grapes', 'Strawberries', 'Blueberries', 'Raspberries', 'Blackberries',
      'Cherries', 'Peaches', 'Nectarines', 'Plums', 'Apricots', 'Pears', 'Pineapple',
      'Mango', 'Papaya', 'Watermelon', 'Cantaloupe', 'Honeydew Melon', 'Kiwi',
      'Pomegranate', 'Figs', 'Dates', 'Persimmon', 'Passion Fruit', 'Dragon Fruit',
      'Star Fruit', 'Guava', 'Lychee', 'Cranberries',
    ],
  },
  {
    key: 'herbs',
    label: 'Fresh Herbs',
    emoji: '🌿',
    items: [
      'Basil', 'Thai Basil', 'Cilantro', 'Parsley', 'Flat Leaf Parsley', 'Mint',
      'Rosemary', 'Thyme', 'Sage', 'Oregano', 'Dill', 'Chives', 'Tarragon',
      'Lemongrass', 'Bay Leaves', 'Curry Leaves',
    ],
  },
  {
    key: 'plant_protein',
    label: 'Plant-Based Proteins',
    emoji: '🌱',
    items: [
      'Tofu', 'Firm Tofu', 'Silken Tofu', 'Smoked Tofu', 'Tempeh', 'Seitan',
      'Edamame', 'Hummus', 'Falafel', 'Veggie Burger', 'Plant-Based Ground',
      'Plant-Based Sausage', 'Black Lentils', 'Red Lentils', 'Green Lentils',
      'Split Green Peas', 'Cannellini Beans', 'Great Northern Beans', 'Lima Beans',
      'Fava Beans', 'Edamame Beans', 'Textured Vegetable Protein', 'Miso Paste',
      'Natto',
    ],
  },
  {
    key: 'protein',
    label: 'Meat, Poultry & Seafood',
    emoji: '🥩',
    items: [
      'Chicken Breast', 'Chicken Thighs', 'Whole Chicken', 'Chicken Wings',
      'Ground Chicken', 'Ground Turkey', 'Turkey Breast', 'Deli Turkey',
      'Ground Beef', 'Beef Chuck Roast', 'Ribeye Steak', 'Flank Steak', 'Beef Brisket',
      'Beef Stew Meat', 'Pork Chops', 'Pork Tenderloin', 'Pulled Pork', 'Bacon',
      'Turkey Bacon', 'Sausage Links', 'Italian Sausage', 'Chorizo', 'Ham', 'Deli Ham',
      'Lamb Chops', 'Ground Lamb', 'Salmon Fillet', 'Tuna Steak', 'Cod', 'Tilapia',
      'Halibut', 'Trout', 'Shrimp', 'Scallops', 'Mussels', 'Clams', 'Crab Meat',
      'Lobster Tail', 'Canned Tuna', 'Canned Salmon', 'Smoked Salmon', 'Anchovies',
    ],
  },
  {
    key: 'dairy',
    label: 'Dairy, Eggs & Alt-Milk',
    emoji: '🧀',
    items: [
      'Milk', 'Whole Milk', 'Skim Milk', 'Half and Half', 'Heavy Cream', 'Buttermilk',
      'Oat Milk', 'Almond Milk', 'Soy Milk', 'Cashew Milk', 'Coconut Milk (Carton)',
      'Vegan Cheese', 'Vegan Butter', 'Cheddar Cheese', 'Mozzarella Cheese',
      'Parmesan Cheese', 'Feta Cheese', 'Goat Cheese', 'Cream Cheese', 'Cottage Cheese',
      'Ricotta Cheese', 'String Cheese', 'Shredded Mexican Blend', 'Sour Cream',
      'Greek Yogurt', 'Plain Yogurt', 'Vanilla Yogurt', 'Coconut Yogurt',
      'Egg Whites', 'Liquid Egg Substitute',
    ],
  },
  {
    key: 'grains_bread',
    label: 'Grains, Bread & Pasta',
    emoji: '🌾',
    items: [
      'White Rice', 'Brown Rice', 'Jasmine Rice', 'Basmati Rice', 'Wild Rice',
      'Arborio Rice', 'Farro', 'Bulgur', 'Barley', 'Couscous', 'Polenta',
      'Grits', 'Steel-Cut Oats', 'Rolled Oats', 'Granola', 'Spaghetti', 'Penne',
      'Fusilli', 'Whole Wheat Pasta', 'Gluten-Free Pasta', 'Lasagna Noodles',
      'Ramen Noodles', 'Rice Noodles', 'Soba Noodles', 'Egg Noodles', 'White Bread',
      'Whole Wheat Bread', 'Sourdough Bread', 'Rye Bread', 'Bagels', 'English Muffins',
      'Dinner Rolls', 'Pita Bread', 'Naan', 'Flour Tortillas', 'Corn Tortillas',
      'Hamburger Buns', 'Hot Dog Buns',
    ],
  },
  {
    key: 'canned_jarred',
    label: 'Canned & Jarred Goods',
    emoji: '🥫',
    items: [
      'Diced Tomatoes', 'Crushed Tomatoes', 'Whole Peeled Tomatoes', 'Tomato Sauce',
      'Marinara Sauce', 'Pasta Sauce', 'Alfredo Sauce', 'Pesto', 'Canned Corn',
      'Canned Pumpkin', 'Applesauce', 'Canned Peaches', 'Canned Pineapple',
      'Green Olives', 'Kalamata Olives', 'Roasted Red Peppers', 'Artichoke Hearts',
      'Pickles', 'Pickled Jalapeños', 'Capers', 'Sun-Dried Tomatoes', 'Coconut Cream',
      'Water Chestnuts', 'Bamboo Shoots', 'Refried Beans', 'Baked Beans',
    ],
  },
  {
    key: 'baking',
    label: 'Baking & Sweeteners',
    emoji: '🧁',
    items: [
      'All-Purpose Flour', 'Whole Wheat Flour', 'Almond Flour', 'Gluten-Free Flour',
      'Self-Rising Flour', 'Bread Flour', 'Cake Flour', 'Cornmeal', 'Chocolate Chips',
      'Dark Chocolate', 'White Chocolate Chips', 'Sprinkles', 'Food Coloring',
      'Cake Mix', 'Brownie Mix', 'Pie Crust', 'Graham Crackers', 'Marshmallows',
      'Coconut Flakes', 'Molasses', 'Corn Syrup', 'Stevia', 'Monk Fruit Sweetener',
      'Almond Extract', 'Lemon Extract',
    ],
  },
  {
    key: 'oils_vinegar',
    label: 'Oils, Vinegars & Fats',
    emoji: '🫒',
    items: [
      'Extra Virgin Olive Oil', 'Avocado Oil', 'Sesame Oil', 'Coconut Oil',
      'Peanut Oil', 'Sunflower Oil', 'Ghee', 'Lard', 'Red Wine Vinegar',
      'White Wine Vinegar', 'Rice Vinegar', 'Sherry Vinegar', 'Champagne Vinegar',
    ],
  },
  {
    key: 'condiments',
    label: 'Condiments, Sauces & Spreads',
    emoji: '🍯',
    items: [
      'Teriyaki Sauce', 'Buffalo Sauce', 'Tzatziki', 'Guacamole', 'Salsa Verde',
      'Pico de Gallo', 'Chimichurri', 'Harissa', 'Gochujang', 'Sambal Oelek',
      'Duck Sauce', 'Steak Sauce', 'Cocktail Sauce', 'Tartar Sauce', 'Remoulade',
      'Aioli', 'Vegan Mayo', 'Apple Butter', 'Fig Jam', 'Orange Marmalade',
      'Nutella', 'Almond Butter', 'Sunflower Seed Butter', 'Marmite',
    ],
  },
  {
    key: 'spices',
    label: 'Spices & Seasonings',
    emoji: '🧂',
    items: [
      'Garam Masala', 'Chinese Five Spice', 'Za\'atar', 'Everything Bagel Seasoning',
      'Taco Seasoning', 'Ranch Seasoning', 'Poultry Seasoning', 'Herbes de Provence',
      'Cajun Seasoning', 'Old Bay Seasoning', 'Adobo Seasoning', 'Smoked Paprika',
      'Sweet Paprika', 'Ground Coriander', 'Ground Cumin', 'Fennel Seeds',
      'Mustard Seeds', 'Star Anise', 'Saffron', 'Sumac', 'Dried Oregano',
      'Dried Basil', 'Dried Rosemary', 'Ground Ginger', 'White Pepper',
      'Crushed Red Pepper', 'MSG', 'Onion Salt', 'Celery Salt', 'Msg-Free Seasoning Blend',
    ],
  },
  {
    key: 'nuts_seeds',
    label: 'Nuts, Seeds & Dried Fruit',
    emoji: '🥜',
    items: [
      'Almonds', 'Cashews', 'Walnuts', 'Pecans', 'Pistachios', 'Macadamia Nuts',
      'Peanuts', 'Pine Nuts', 'Brazil Nuts', 'Sunflower Seeds', 'Pumpkin Seeds',
      'Chia Seeds', 'Flax Seeds', 'Hemp Seeds', 'Sesame Seeds', 'Raisins',
      'Dried Cranberries', 'Dried Apricots', 'Dried Mango', 'Prunes', 'Dried Figs',
      'Trail Mix',
    ],
  },
  {
    key: 'snacks_bev',
    label: 'Snacks & Beverages',
    emoji: '☕',
    items: [
      'Coffee Beans', 'Ground Coffee', 'Instant Coffee', 'Green Tea', 'Black Tea',
      'Herbal Tea', 'Matcha Powder', 'Hot Chocolate Mix', 'Sparkling Water',
      'Coconut Water', 'Crackers', 'Tortilla Chips', 'Pretzels', 'Popcorn',
      'Rice Cakes', 'Granola Bars', 'Protein Bars', 'Dark Chocolate Bar',
    ],
  },
];

// Flat list of every catalog name (handy for search / counts / tests).
export const ALL_CATALOG_ITEMS = INGREDIENT_CATALOG.flatMap((c) => c.items);

export default INGREDIENT_CATALOG;
