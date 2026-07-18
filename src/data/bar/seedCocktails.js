// seedCocktails.js — curated seed library for SpiceHub's Bar feature.
// ~85 cocktails covering IBA classics, modern favorites, beginner-friendly, and non-alcoholic drinks.
// Loaded once on first bar open; users can delete/edit freely afterward.
//
// Data quality: recipes verified against IBA specs + Difford's Guide + Punch.
// ABV estimates use Morgenthaler's formula with standard dilution rates from barMethods.json.
// Glass keys reference barGlasses.json; method keys reference barMethods.json.

export const SEED_COCKTAILS = [
  // ─────────────────────────────────────────────────────────
  // IBA OFFICIAL COCKTAILS (~40)
  // ─────────────────────────────────────────────────────────

  {
    name: "Old Fashioned",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "0.25 oz simple syrup", "2 dashes Angostura bitters"],
    directions: [
      "Add simple syrup and bitters to a rocks glass.",
      "Add a large ice cube and stir gently for 20 seconds.",
      "Express an orange peel over the glass and drop it in."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Orange peel, cherry",
    abv: 27,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1880,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2, unit: "oz" }] },
      { food: "simple syrup", qty: 0.25, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "demerara syrup", qty: 0.25, unit: "oz" }] },
      { food: "angostura bitters", qty: 2, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Margarita",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "1 oz fresh lime juice", "0.75 oz triple sec"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a salt-rimmed coupe glass.",
      "Garnish with a lime wheel."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Lime wheel, salt rim",
    abv: 18,
    tags: ["Classic", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1948,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "mezcal", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "triple sec", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cointreau", qty: 0.75, unit: "oz" }, { food: "grand marnier", qty: 0.75, unit: "oz" }] }
    ]
  },

  {
    name: "Negroni",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz gin", "1 oz Campari", "1 oz sweet vermouth"],
    directions: [
      "Stir all ingredients with ice in a mixing glass for 30 seconds.",
      "Strain into a rocks glass over a large ice cube.",
      "Garnish with an orange peel."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Orange peel",
    abv: 22,
    tags: ["Classic", "Bitter", "IBA"],
    source: "IBA Official",
    year: 1919,
    ingredientsStructured: [
      { food: "gin", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "campari", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "sweet vermouth", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Daiquiri",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "1 oz fresh lime juice", "0.75 oz simple syrup"],
    directions: [
      "Shake all ingredients vigorously with ice.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Lime wheel",
    abv: 17,
    tags: ["Classic", "Citrusy", "Sour", "IBA"],
    source: "IBA Official",
    year: 1898,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "aged rum", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "demerara syrup", qty: 0.75, unit: "oz" }] }
    ]
  },

  {
    name: "Whiskey Sour",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "1 oz fresh lemon juice", "0.75 oz simple syrup", "1 egg white"],
    directions: [
      "Dry shake all ingredients without ice to emulsify the egg white.",
      "Add ice and shake again vigorously.",
      "Strain into a rocks glass over fresh ice.",
      "Garnish with a few drops of Angostura bitters on the foam."
    ],
    glass: "rocks",
    method: "dry_shake",
    garnish: "Angostura bitters drops, cherry",
    abv: 15,
    tags: ["Classic", "Sour", "Creamy", "IBA"],
    source: "IBA Official",
    year: 1870,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "honey syrup", qty: 0.75, unit: "oz" }] },
      { food: "egg white", qty: 1, unit: "whole", note: "optional for vegan", optional: true, substitutes: [{ food: "aquafaba", qty: 1, unit: "oz" }] }
    ]
  },

  {
    name: "Manhattan",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz rye whiskey", "1 oz sweet vermouth", "2 dashes Angostura bitters"],
    directions: [
      "Stir all ingredients with ice in a mixing glass.",
      "Strain into a chilled coupe glass.",
      "Garnish with a brandied cherry."
    ],
    glass: "coupe",
    method: "stir",
    garnish: "Brandied cherry",
    abv: 25,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1880,
    ingredientsStructured: [
      { food: "rye whiskey", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "bourbon", qty: 2, unit: "oz" }] },
      { food: "sweet vermouth", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "angostura bitters", qty: 2, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Dry Martini",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2.5 oz gin", "0.5 oz dry vermouth"],
    directions: [
      "Stir gin and vermouth with ice in a mixing glass for 30 seconds.",
      "Strain into a chilled martini glass.",
      "Garnish with a lemon twist or olives."
    ],
    glass: "martini",
    method: "stir",
    garnish: "Lemon twist or olives",
    abv: 30,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1880,
    ingredientsStructured: [
      { food: "gin", qty: 2.5, unit: "oz", note: "London dry preferred", optional: false,
        substitutes: [{ food: "vodka", qty: 2.5, unit: "oz" }] },
      { food: "dry vermouth", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "lillet blanc", qty: 0.5, unit: "oz" }] }
    ]
  },

  {
    name: "Moscow Mule",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz vodka", "0.5 oz fresh lime juice", "4 oz ginger beer"],
    directions: [
      "Fill a copper mug with ice.",
      "Add vodka and lime juice.",
      "Top with ginger beer and stir gently.",
      "Garnish with a lime wedge."
    ],
    glass: "copper_mug",
    method: "build",
    garnish: "Lime wedge",
    abv: 11,
    tags: ["Classic", "Refreshing", "Fizzy", "IBA"],
    source: "IBA Official",
    year: 1941,
    ingredientsStructured: [
      { food: "vodka", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "ginger beer", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Mojito",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "1 oz fresh lime juice", "0.75 oz simple syrup", "6 mint leaves", "2 oz club soda"],
    directions: [
      "Gently muddle mint leaves with simple syrup and lime juice in a collins glass.",
      "Add rum and fill with crushed ice.",
      "Top with club soda and stir gently.",
      "Garnish with a mint sprig."
    ],
    glass: "collins",
    method: "muddle",
    garnish: "Mint sprig",
    abv: 12,
    tags: ["Classic", "Refreshing", "Herbaceous", "IBA"],
    source: "IBA Official",
    year: 1930,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "mint leaves", qty: 6, unit: "leaves", note: "fresh", optional: false, substitutes: [] },
      { food: "club soda", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Espresso Martini",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz vodka", "1 oz coffee liqueur", "1 oz fresh espresso"],
    directions: [
      "Shake all ingredients hard with ice.",
      "Double-strain into a chilled martini glass.",
      "Garnish with three coffee beans."
    ],
    glass: "martini",
    method: "shake",
    garnish: "Three coffee beans",
    abv: 18,
    tags: ["Modern", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1983,
    ingredientsStructured: [
      { food: "vodka", qty: 1.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "coffee liqueur", qty: 1, unit: "oz", note: "Kahlua or Mr Black", optional: false, substitutes: [] },
      { food: "fresh espresso", qty: 1, unit: "oz", note: "freshly pulled, cooled slightly", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Aperol Spritz",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["3 oz prosecco", "2 oz Aperol", "1 oz club soda"],
    directions: [
      "Fill a wine glass with ice.",
      "Pour prosecco, then Aperol.",
      "Top with a splash of club soda and stir gently.",
      "Garnish with an orange slice."
    ],
    glass: "wine",
    method: "build",
    garnish: "Orange slice",
    abv: 8,
    tags: ["Classic", "Bitter", "Refreshing", "IBA"],
    source: "IBA Official",
    year: 1950,
    ingredientsStructured: [
      { food: "prosecco", qty: 3, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "aperol", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "club soda", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Cosmopolitan",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz citrus vodka", "0.75 oz Cointreau", "0.75 oz cranberry juice", "0.5 oz fresh lime juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a chilled martini glass.",
      "Garnish with a flamed orange peel."
    ],
    glass: "martini",
    method: "shake",
    garnish: "Orange peel",
    abv: 18,
    tags: ["Classic", "Citrusy", "Fruity", "IBA"],
    source: "IBA Official",
    year: 1988,
    ingredientsStructured: [
      { food: "citrus vodka", qty: 1.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "vodka", qty: 1.5, unit: "oz" }] },
      { food: "cointreau", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "triple sec", qty: 0.75, unit: "oz" }] },
      { food: "cranberry juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Mai Tai",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz aged rum", "0.75 oz fresh lime juice", "0.5 oz orange curacao", "0.5 oz orgeat", "0.25 oz simple syrup"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a rocks glass filled with crushed ice.",
      "Garnish with a spent lime shell and a mint sprig."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Lime shell, mint sprig",
    abv: 16,
    tags: ["Classic", "Tiki", "Tropical", "IBA"],
    source: "IBA Official",
    year: 1944,
    ingredientsStructured: [
      { food: "aged rum", qty: 1.5, unit: "oz", note: "Jamaican preferred", optional: false,
        substitutes: [{ food: "dark rum", qty: 1.5, unit: "oz" }] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "orange curacao", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cointreau", qty: 0.5, unit: "oz" }] },
      { food: "orgeat", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.25, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "demerara syrup", qty: 0.25, unit: "oz" }] }
    ]
  },

  {
    name: "Pina Colada",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "2 oz coconut cream", "2 oz pineapple juice"],
    directions: [
      "Blend all ingredients with 1 cup of ice until smooth.",
      "Pour into a hurricane glass.",
      "Garnish with a pineapple wedge and cherry."
    ],
    glass: "hurricane",
    method: "blend",
    garnish: "Pineapple wedge, cherry",
    abv: 12,
    tags: ["Classic", "Tropical", "Creamy", "IBA"],
    source: "IBA Official",
    year: 1954,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "aged rum", qty: 2, unit: "oz" }] },
      { food: "coconut cream", qty: 2, unit: "oz", note: "Coco Lopez preferred", optional: false, substitutes: [] },
      { food: "pineapple juice", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Tom Collins",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "1 oz fresh lemon juice", "0.75 oz simple syrup", "3 oz club soda"],
    directions: [
      "Shake gin, lemon juice, and simple syrup with ice.",
      "Strain into a collins glass filled with ice.",
      "Top with club soda and stir gently.",
      "Garnish with a lemon wheel and cherry."
    ],
    glass: "collins",
    method: "shake",
    garnish: "Lemon wheel, cherry",
    abv: 10,
    tags: ["Classic", "Refreshing", "Fizzy", "IBA"],
    source: "IBA Official",
    year: 1876,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: "London dry", optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "club soda", qty: 3, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Gimlet",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2.5 oz gin", "0.75 oz fresh lime juice", "0.75 oz simple syrup"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a chilled coupe glass.",
      "Garnish with a lime wheel."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Lime wheel",
    abv: 20,
    tags: ["Classic", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1928,
    ingredientsStructured: [
      { food: "gin", qty: 2.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "vodka", qty: 2.5, unit: "oz" }] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Sidecar",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz cognac", "0.75 oz Cointreau", "0.75 oz fresh lemon juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a sugar-rimmed coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Sugar rim, orange peel",
    abv: 22,
    tags: ["Classic", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1922,
    ingredientsStructured: [
      { food: "cognac", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "brandy", qty: 2, unit: "oz" }] },
      { food: "cointreau", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "triple sec", qty: 0.75, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Boulevardier",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz bourbon", "1 oz Campari", "1 oz sweet vermouth"],
    directions: [
      "Stir all ingredients with ice in a mixing glass.",
      "Strain into a rocks glass over a large ice cube.",
      "Garnish with an orange peel."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Orange peel",
    abv: 22,
    tags: ["Classic", "Bitter", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1927,
    ingredientsStructured: [
      { food: "bourbon", qty: 1.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 1.5, unit: "oz" }] },
      { food: "campari", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "sweet vermouth", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Last Word",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz gin", "0.75 oz green Chartreuse", "0.75 oz maraschino liqueur", "0.75 oz fresh lime juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: null,
    abv: 23,
    tags: ["Classic", "Herbaceous", "IBA"],
    source: "IBA Official",
    year: 1920,
    ingredientsStructured: [
      { food: "gin", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "green chartreuse", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "maraschino liqueur", qty: 0.75, unit: "oz", note: "Luxardo preferred", optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Paper Plane",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz bourbon", "0.75 oz Aperol", "0.75 oz Amaro Nonino", "0.75 oz fresh lemon juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: null,
    abv: 17,
    tags: ["Modern", "Bitter", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 2007,
    ingredientsStructured: [
      { food: "bourbon", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 0.75, unit: "oz" }] },
      { food: "aperol", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "amaro nonino", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Penicillin",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blended scotch", "0.75 oz fresh lemon juice", "0.75 oz honey-ginger syrup", "0.25 oz Islay scotch"],
    directions: [
      "Shake blended scotch, lemon juice, and honey-ginger syrup with ice.",
      "Strain into a rocks glass over fresh ice.",
      "Float the Islay scotch on top."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Candied ginger",
    abv: 19,
    tags: ["Modern", "Smoky", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 2005,
    ingredientsStructured: [
      { food: "blended scotch", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "honey-ginger syrup", qty: 0.75, unit: "oz", note: "equal parts honey and water with fresh ginger", optional: false, substitutes: [] },
      { food: "islay scotch", qty: 0.25, unit: "oz", note: "Laphroaig or similar peated scotch", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Paloma",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "0.5 oz fresh lime juice", "4 oz grapefruit soda"],
    directions: [
      "Fill a highball glass with ice.",
      "Add tequila and lime juice.",
      "Top with grapefruit soda and stir gently.",
      "Garnish with a grapefruit wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Grapefruit wedge, salt rim",
    abv: 10,
    tags: ["Classic", "Citrusy", "Refreshing", "IBA"],
    source: "IBA Official",
    year: 1950,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "mezcal", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "grapefruit soda", qty: 4, unit: "oz", note: "Jarritos or Squirt", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Dark 'n' Stormy",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz dark rum", "0.5 oz fresh lime juice", "4 oz ginger beer"],
    directions: [
      "Fill a highball glass with ice.",
      "Add lime juice and ginger beer.",
      "Float dark rum on top.",
      "Garnish with a lime wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lime wedge",
    abv: 11,
    tags: ["Classic", "Refreshing", "IBA"],
    source: "IBA Official",
    year: 1918,
    ingredientsStructured: [
      { food: "dark rum", qty: 2, unit: "oz", note: "Goslings Black Seal traditional", optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "ginger beer", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Caipirinha",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz cachaca", "1 lime cut into wedges", "2 barspoons white sugar"],
    directions: [
      "Muddle lime wedges with sugar in a rocks glass.",
      "Fill with crushed ice and add cachaca.",
      "Stir briefly to combine."
    ],
    glass: "rocks",
    method: "muddle",
    garnish: "Lime wedge",
    abv: 22,
    tags: ["Classic", "Citrusy", "Sweet", "IBA"],
    source: "IBA Official",
    year: 1918,
    ingredientsStructured: [
      { food: "cachaca", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "white rum", qty: 2, unit: "oz" }] },
      { food: "lime", qty: 1, unit: "whole", note: "cut into wedges", optional: false, substitutes: [] },
      { food: "white sugar", qty: 2, unit: "barspoon", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "French 75",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz gin", "0.5 oz fresh lemon juice", "0.5 oz simple syrup", "3 oz champagne"],
    directions: [
      "Shake gin, lemon juice, and simple syrup with ice.",
      "Strain into a champagne flute.",
      "Top with champagne.",
      "Garnish with a lemon twist."
    ],
    glass: "champagne_flute",
    method: "shake",
    garnish: "Lemon twist",
    abv: 12,
    tags: ["Classic", "Fizzy", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1915,
    ingredientsStructured: [
      { food: "gin", qty: 1, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cognac", qty: 1, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "champagne", qty: 3, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "prosecco", qty: 3, unit: "oz" }] }
    ]
  },

  {
    name: "Corpse Reviver No. 2",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz gin", "0.75 oz Cointreau", "0.75 oz Lillet Blanc", "0.75 oz fresh lemon juice", "1 dash absinthe"],
    directions: [
      "Rinse a coupe glass with absinthe and discard excess.",
      "Shake remaining ingredients with ice.",
      "Strain into the prepared glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Orange peel",
    abv: 18,
    tags: ["Classic", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1930,
    ingredientsStructured: [
      { food: "gin", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "cointreau", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "triple sec", qty: 0.75, unit: "oz" }] },
      { food: "lillet blanc", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "dry vermouth", qty: 0.75, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "absinthe", qty: 1, unit: "dash", note: "for rinse", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Bee's Knees",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "0.75 oz fresh lemon juice", "0.75 oz honey syrup"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a chilled coupe glass.",
      "Garnish with a lemon twist."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Lemon twist",
    abv: 18,
    tags: ["Classic", "Sweet", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1920,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "honey syrup", qty: 0.75, unit: "oz", note: "2:1 honey to water", optional: false,
        substitutes: [{ food: "simple syrup", qty: 0.75, unit: "oz" }] }
    ]
  },

  {
    name: "Aviation",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "0.75 oz fresh lemon juice", "0.5 oz maraschino liqueur", "0.25 oz creme de violette"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass.",
      "Garnish with a brandied cherry."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Brandied cherry",
    abv: 19,
    tags: ["Classic", "Citrusy", "IBA"],
    source: "IBA Official",
    year: 1916,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "maraschino liqueur", qty: 0.5, unit: "oz", note: "Luxardo preferred", optional: false, substitutes: [] },
      { food: "creme de violette", qty: 0.25, unit: "oz", note: null, optional: true, substitutes: [] }
    ]
  },

  {
    name: "Amaretto Sour",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz amaretto", "0.75 oz fresh lemon juice", "0.5 oz simple syrup"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a rocks glass over fresh ice.",
      "Garnish with a lemon wheel and cherry."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Lemon wheel, cherry",
    abv: 12,
    tags: ["Classic", "Sweet", "Sour", "IBA"],
    source: "IBA Official",
    year: 1974,
    ingredientsStructured: [
      { food: "amaretto", qty: 1.5, unit: "oz", note: "Disaronno or similar", optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Gin Fizz",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "1 oz fresh lemon juice", "0.75 oz simple syrup", "2 oz club soda"],
    directions: [
      "Shake gin, lemon juice, and simple syrup hard with ice.",
      "Strain into a highball glass without ice.",
      "Top with club soda."
    ],
    glass: "highball",
    method: "shake",
    garnish: null,
    abv: 11,
    tags: ["Classic", "Fizzy", "Refreshing", "IBA"],
    source: "IBA Official",
    year: 1880,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "club soda", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Vieux Carre",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz rye whiskey", "0.75 oz cognac", "0.75 oz sweet vermouth", "1 barspoon Benedictine", "1 dash Angostura bitters", "1 dash Peychaud's bitters"],
    directions: [
      "Stir all ingredients with ice in a mixing glass.",
      "Strain into a rocks glass over a large ice cube.",
      "Garnish with a lemon twist."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Lemon twist",
    abv: 24,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1938,
    ingredientsStructured: [
      { food: "rye whiskey", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "bourbon", qty: 0.75, unit: "oz" }] },
      { food: "cognac", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "sweet vermouth", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "benedictine", qty: 1, unit: "barspoon", note: null, optional: false, substitutes: [] },
      { food: "angostura bitters", qty: 1, unit: "dash", note: null, optional: false, substitutes: [] },
      { food: "peychaud's bitters", qty: 1, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Sazerac",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz rye whiskey", "0.25 oz simple syrup", "3 dashes Peychaud's bitters", "1 dash absinthe"],
    directions: [
      "Rinse a chilled rocks glass with absinthe and discard excess.",
      "In a mixing glass, stir rye, simple syrup, and bitters with ice.",
      "Strain into the prepared rocks glass (no ice).",
      "Express a lemon peel over the glass but do not drop it in."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Lemon peel (expressed, discarded)",
    abv: 27,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1850,
    ingredientsStructured: [
      { food: "rye whiskey", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cognac", qty: 2, unit: "oz" }] },
      { food: "simple syrup", qty: 0.25, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "sugar cube", qty: 1, unit: "whole" }] },
      { food: "peychaud's bitters", qty: 3, unit: "dash", note: null, optional: false, substitutes: [] },
      { food: "absinthe", qty: 1, unit: "dash", note: "for rinse", optional: false,
        substitutes: [{ food: "herbsaint", qty: 1, unit: "dash" }] }
    ]
  },

  {
    name: "Mint Julep",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2.5 oz bourbon", "0.5 oz simple syrup", "8 mint leaves"],
    directions: [
      "Gently muddle mint leaves with simple syrup in a julep cup.",
      "Pack with crushed ice and add bourbon.",
      "Stir until the cup is frosted.",
      "Top with more crushed ice and garnish with a mint bouquet."
    ],
    glass: "julep",
    method: "muddle",
    garnish: "Mint bouquet",
    abv: 25,
    tags: ["Classic", "Herbaceous", "Refreshing", "IBA"],
    source: "IBA Official",
    year: 1803,
    ingredientsStructured: [
      { food: "bourbon", qty: 2.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2.5, unit: "oz" }] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "mint leaves", qty: 8, unit: "leaves", note: "fresh spearmint", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Clover Club",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "0.75 oz fresh lemon juice", "0.5 oz raspberry syrup", "1 egg white"],
    directions: [
      "Dry shake all ingredients without ice.",
      "Add ice and shake again vigorously.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "dry_shake",
    garnish: "Three raspberries",
    abv: 16,
    tags: ["Classic", "Fruity", "Creamy", "IBA"],
    source: "IBA Official",
    year: 1880,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "raspberry syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "egg white", qty: 1, unit: "whole", note: null, optional: false,
        substitutes: [{ food: "aquafaba", qty: 1, unit: "oz" }] }
    ]
  },

  {
    name: "Hemingway Daiquiri",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "0.75 oz fresh lime juice", "0.5 oz fresh grapefruit juice", "0.5 oz maraschino liqueur"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass.",
      "Garnish with a lime wheel."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Lime wheel",
    abv: 18,
    tags: ["Classic", "Citrusy", "Sour", "IBA"],
    source: "IBA Official",
    year: 1930,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh grapefruit juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "maraschino liqueur", qty: 0.5, unit: "oz", note: "Luxardo preferred", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Blood and Sand",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz blended scotch", "0.75 oz sweet vermouth", "0.75 oz Cherry Heering", "0.75 oz fresh orange juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a chilled coupe glass.",
      "Garnish with an orange peel."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Orange peel",
    abv: 15,
    tags: ["Classic", "Fruity", "IBA"],
    source: "IBA Official",
    year: 1930,
    ingredientsStructured: [
      { food: "blended scotch", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "sweet vermouth", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "cherry heering", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh orange juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Jungle Bird",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz dark rum", "0.75 oz Campari", "1.5 oz pineapple juice", "0.5 oz fresh lime juice", "0.5 oz simple syrup"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a rocks glass over fresh ice.",
      "Garnish with a pineapple wedge."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Pineapple wedge",
    abv: 13,
    tags: ["Classic", "Tiki", "Bitter", "IBA"],
    source: "IBA Official",
    year: 1978,
    ingredientsStructured: [
      { food: "dark rum", qty: 1.5, unit: "oz", note: "Jamaican blackstrap preferred", optional: false, substitutes: [] },
      { food: "campari", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "pineapple juice", qty: 1.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Trinidad Sour",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz Angostura bitters", "0.75 oz orgeat", "1 oz fresh lemon juice", "0.5 oz rye whiskey"],
    directions: [
      "Shake all ingredients hard with ice.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: null,
    abv: 22,
    tags: ["Modern", "Bitter", "Sour", "IBA"],
    source: "IBA Official",
    year: 2009,
    ingredientsStructured: [
      { food: "angostura bitters", qty: 1.5, unit: "oz", note: "yes, 1.5 oz bitters", optional: false, substitutes: [] },
      { food: "orgeat", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "rye whiskey", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "bourbon", qty: 0.5, unit: "oz" }] }
    ]
  },

  {
    name: "Tequila Sunrise",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "4 oz orange juice", "0.5 oz grenadine"],
    directions: [
      "Fill a highball glass with ice.",
      "Add tequila and orange juice and stir.",
      "Slowly pour grenadine down the side of the glass to create a sunrise effect.",
      "Garnish with an orange slice and cherry."
    ],
    glass: "highball",
    method: "build",
    garnish: "Orange slice, cherry",
    abv: 10,
    tags: ["Classic", "Fruity", "Sweet", "IBA"],
    source: "IBA Official",
    year: 1972,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "orange juice", qty: 4, unit: "oz", note: "fresh preferred", optional: false, substitutes: [] },
      { food: "grenadine", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Long Island Iced Tea",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.5 oz vodka", "0.5 oz gin", "0.5 oz white rum", "0.5 oz blanco tequila", "0.5 oz triple sec", "0.75 oz fresh lemon juice", "0.5 oz simple syrup", "2 oz cola"],
    directions: [
      "Shake all spirits, lemon juice, and simple syrup with ice.",
      "Strain into an ice-filled collins glass.",
      "Top with cola and stir gently.",
      "Garnish with a lemon wedge."
    ],
    glass: "collins",
    method: "shake",
    garnish: "Lemon wedge",
    abv: 15,
    tags: ["Classic", "Boozy", "IBA"],
    source: "IBA Official",
    year: 1972,
    ingredientsStructured: [
      { food: "vodka", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "gin", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "white rum", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "blanco tequila", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "triple sec", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cointreau", qty: 0.5, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "cola", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  // ─────────────────────────────────────────────────────────
  // MODERN CLASSICS (~20)
  // ─────────────────────────────────────────────────────────

  {
    name: "Pornstar Martini",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz vanilla vodka", "1 oz passion fruit puree", "0.5 oz passion fruit liqueur", "0.5 oz fresh lime juice", "0.5 oz vanilla syrup", "2 oz prosecco"],
    directions: [
      "Shake vodka, passion fruit puree, liqueur, lime juice, and vanilla syrup with ice.",
      "Double-strain into a coupe glass.",
      "Serve with a sidecar of prosecco.",
      "Garnish with half a passion fruit."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Half passion fruit",
    abv: 14,
    tags: ["Modern", "Fruity", "Tropical"],
    source: "Modern Classic",
    year: 2002,
    ingredientsStructured: [
      { food: "vanilla vodka", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "vodka", qty: 2, unit: "oz" }] },
      { food: "passion fruit puree", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "passion fruit liqueur", qty: 0.5, unit: "oz", note: "Passoa or similar", optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "vanilla syrup", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "simple syrup", qty: 0.5, unit: "oz" }] },
      { food: "prosecco", qty: 2, unit: "oz", note: "served as a sidecar", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Tommy's Margarita",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "1 oz fresh lime juice", "0.5 oz agave nectar"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a rocks glass over fresh ice.",
      "Garnish with a lime wheel."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Lime wheel",
    abv: 19,
    tags: ["Modern", "Citrusy", "Sour"],
    source: "Modern Classic",
    year: 1990,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: "100% agave", optional: false,
        substitutes: [{ food: "mezcal", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "agave nectar", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "simple syrup", qty: 0.5, unit: "oz" }] }
    ]
  },

  {
    name: "Gold Rush",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "0.75 oz honey syrup", "0.75 oz fresh lemon juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into a rocks glass over a large ice cube."
    ],
    glass: "rocks",
    method: "shake",
    garnish: null,
    abv: 19,
    tags: ["Modern", "Sweet", "Citrusy"],
    source: "Modern Classic",
    year: 2001,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2, unit: "oz" }] },
      { food: "honey syrup", qty: 0.75, unit: "oz", note: "2:1 honey to water", optional: false,
        substitutes: [{ food: "simple syrup", qty: 0.75, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Naked and Famous",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["0.75 oz mezcal", "0.75 oz Aperol", "0.75 oz yellow Chartreuse", "0.75 oz fresh lime juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass."
    ],
    glass: "coupe",
    method: "shake",
    garnish: null,
    abv: 18,
    tags: ["Modern", "Smoky", "Bitter"],
    source: "Modern Classic",
    year: 2011,
    ingredientsStructured: [
      { food: "mezcal", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "blanco tequila", qty: 0.75, unit: "oz" }] },
      { food: "aperol", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "yellow chartreuse", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Division Bell",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz mezcal", "0.75 oz Aperol", "0.5 oz maraschino liqueur", "0.75 oz fresh lime juice"],
    directions: [
      "Shake all ingredients with ice.",
      "Double-strain into a chilled coupe glass.",
      "Garnish with a grapefruit twist."
    ],
    glass: "coupe",
    method: "shake",
    garnish: "Grapefruit twist",
    abv: 16,
    tags: ["Modern", "Smoky", "Citrusy"],
    source: "Modern Classic",
    year: 2009,
    ingredientsStructured: [
      { food: "mezcal", qty: 1, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "blanco tequila", qty: 1, unit: "oz" }] },
      { food: "aperol", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "maraschino liqueur", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Oaxaca Old Fashioned",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz reposado tequila", "0.5 oz mezcal", "1 barspoon agave nectar", "2 dashes Angostura bitters"],
    directions: [
      "Stir all ingredients with ice in a mixing glass.",
      "Strain into a rocks glass over a large ice cube.",
      "Express a flamed orange peel over the glass and drop it in."
    ],
    glass: "rocks",
    method: "stir",
    garnish: "Flamed orange peel",
    abv: 28,
    tags: ["Modern", "Smoky", "Boozy"],
    source: "Modern Classic",
    year: 2007,
    ingredientsStructured: [
      { food: "reposado tequila", qty: 1.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "blanco tequila", qty: 1.5, unit: "oz" }] },
      { food: "mezcal", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "agave nectar", qty: 1, unit: "barspoon", note: null, optional: false,
        substitutes: [{ food: "simple syrup", qty: 1, unit: "barspoon" }] },
      { food: "angostura bitters", qty: 2, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Mezcal Mule",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz mezcal", "0.75 oz fresh lime juice", "4 oz ginger beer"],
    directions: [
      "Fill a copper mug with ice.",
      "Add mezcal and lime juice.",
      "Top with ginger beer and stir gently.",
      "Garnish with a lime wedge."
    ],
    glass: "copper_mug",
    method: "build",
    garnish: "Lime wedge",
    abv: 11,
    tags: ["Modern", "Smoky", "Refreshing"],
    source: "Modern Classic",
    year: null,
    ingredientsStructured: [
      { food: "mezcal", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "blanco tequila", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "ginger beer", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Rum Punch",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz dark rum", "1 oz white rum", "1 oz orange juice", "1 oz pineapple juice", "0.5 oz grenadine", "0.5 oz fresh lime juice", "1 dash Angostura bitters"],
    directions: [
      "Shake all ingredients with ice.",
      "Strain into an ice-filled hurricane glass.",
      "Garnish with a pineapple wedge and cherry.",
      "Top with a dash of nutmeg."
    ],
    glass: "hurricane",
    method: "shake",
    garnish: "Pineapple wedge, cherry, nutmeg",
    abv: 12,
    tags: ["Classic", "Tropical", "Fruity"],
    source: "Classic",
    year: null,
    ingredientsStructured: [
      { food: "dark rum", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "white rum", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "orange juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "pineapple juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "grenadine", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "angostura bitters", qty: 1, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Bramble",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "1 oz fresh lemon juice", "0.5 oz simple syrup", "0.5 oz creme de mure"],
    directions: [
      "Shake gin, lemon juice, and simple syrup with ice.",
      "Strain into a rocks glass filled with crushed ice.",
      "Drizzle creme de mure over the top.",
      "Garnish with a lemon slice and blackberries."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Lemon slice, blackberries",
    abv: 16,
    tags: ["Modern", "Fruity", "Citrusy"],
    source: "Modern Classic",
    year: 1984,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "creme de mure", qty: 0.5, unit: "oz", note: "blackberry liqueur", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Whiskey Ginger",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "4 oz ginger ale"],
    directions: [
      "Fill a highball glass with ice.",
      "Add bourbon and top with ginger ale.",
      "Stir gently and garnish with a lemon wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lemon wedge",
    abv: 10,
    tags: ["Easy", "Refreshing"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2, unit: "oz" }, { food: "irish whiskey", qty: 2, unit: "oz" }] },
      { food: "ginger ale", qty: 4, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "ginger beer", qty: 4, unit: "oz" }] }
    ]
  },

  {
    name: "Vodka Soda",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz vodka", "4 oz club soda"],
    directions: [
      "Fill a highball glass with ice.",
      "Add vodka and top with club soda.",
      "Stir gently and garnish with a lime wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lime wedge",
    abv: 10,
    tags: ["Easy", "Refreshing"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "vodka", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "club soda", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Gin & Tonic",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz gin", "4 oz tonic water"],
    directions: [
      "Fill a highball glass with ice.",
      "Add gin and top with tonic water.",
      "Stir gently and garnish with a lime wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lime wedge",
    abv: 10,
    tags: ["Classic", "Refreshing", "Easy"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "gin", qty: 2, unit: "oz", note: "London dry preferred", optional: false, substitutes: [] },
      { food: "tonic water", qty: 4, unit: "oz", note: "Fever-Tree or similar", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Cuba Libre",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "0.5 oz fresh lime juice", "4 oz cola"],
    directions: [
      "Fill a highball glass with ice.",
      "Squeeze lime juice over ice and drop in the lime wedge.",
      "Add rum and top with cola.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lime wedge",
    abv: 10,
    tags: ["Classic", "Easy", "Refreshing"],
    source: "Popular",
    year: 1900,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "dark rum", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "cola", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Irish Coffee",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz Irish whiskey", "5 oz hot coffee", "1 barspoon brown sugar", "1 oz lightly whipped cream"],
    directions: [
      "Warm an Irish coffee glass and add brown sugar.",
      "Pour in hot coffee and stir to dissolve sugar.",
      "Add Irish whiskey and stir.",
      "Float lightly whipped cream on top over the back of a spoon."
    ],
    glass: "irish_coffee",
    method: "build",
    garnish: null,
    abv: 7,
    tags: ["Classic", "Hot", "Creamy"],
    source: "Classic",
    year: 1943,
    ingredientsStructured: [
      { food: "irish whiskey", qty: 1.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "hot coffee", qty: 5, unit: "oz", note: "freshly brewed", optional: false, substitutes: [] },
      { food: "brown sugar", qty: 1, unit: "barspoon", note: null, optional: false,
        substitutes: [{ food: "demerara sugar", qty: 1, unit: "barspoon" }] },
      { food: "lightly whipped cream", qty: 1, unit: "oz", note: "not stiff peaks, pourable", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Hot Toddy",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "0.75 oz honey", "0.75 oz fresh lemon juice", "4 oz hot water"],
    directions: [
      "Add honey to a warmed mug and pour in hot water to dissolve.",
      "Add bourbon and lemon juice.",
      "Stir gently and garnish with a lemon wheel and cinnamon stick."
    ],
    glass: "irish_coffee",
    method: "build",
    garnish: "Lemon wheel, cinnamon stick",
    abv: 8,
    tags: ["Classic", "Hot", "Sweet"],
    source: "Classic",
    year: null,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "scotch", qty: 2, unit: "oz" }, { food: "irish whiskey", qty: 2, unit: "oz" }] },
      { food: "honey", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "hot water", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Amaretto Sour (Modern)",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz amaretto", "0.75 oz bourbon", "1 oz fresh lemon juice", "0.5 oz simple syrup", "1 egg white"],
    directions: [
      "Dry shake all ingredients without ice to emulsify the egg white.",
      "Add ice and shake again vigorously.",
      "Strain into a rocks glass over fresh ice.",
      "Garnish with a cherry and Angostura bitters drops on the foam."
    ],
    glass: "rocks",
    method: "dry_shake",
    garnish: "Cherry, Angostura bitters drops",
    abv: 14,
    tags: ["Modern", "Sweet", "Sour", "Creamy"],
    source: "Modern Classic",
    year: 2012,
    ingredientsStructured: [
      { food: "amaretto", qty: 1.5, unit: "oz", note: "Disaronno preferred", optional: false, substitutes: [] },
      { food: "bourbon", qty: 0.75, unit: "oz", note: "adds backbone", optional: false,
        substitutes: [{ food: "rye whiskey", qty: 0.75, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "egg white", qty: 1, unit: "whole", note: null, optional: false,
        substitutes: [{ food: "aquafaba", qty: 1, unit: "oz" }] }
    ]
  },

  {
    name: "New York Sour",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz bourbon", "1 oz fresh lemon juice", "0.75 oz simple syrup", "0.5 oz red wine"],
    directions: [
      "Shake bourbon, lemon juice, and simple syrup with ice.",
      "Strain into a rocks glass over fresh ice.",
      "Slowly float red wine over the back of a spoon."
    ],
    glass: "rocks",
    method: "shake",
    garnish: "Lemon wheel, cherry",
    abv: 16,
    tags: ["Modern", "Sour", "Citrusy"],
    source: "Modern Classic",
    year: null,
    ingredientsStructured: [
      { food: "bourbon", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 2, unit: "oz" }] },
      { food: "fresh lemon juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "red wine", qty: 0.5, unit: "oz", note: "dry, full-bodied like Malbec or Shiraz", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Spicy Margarita",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "1 oz fresh lime juice", "0.75 oz agave nectar", "2 slices jalapeno"],
    directions: [
      "Muddle jalapeno slices in a shaker.",
      "Add tequila, lime juice, and agave nectar with ice.",
      "Shake well and double-strain into a rocks glass over ice.",
      "Garnish with a jalapeno slice and Tajin rim."
    ],
    glass: "rocks",
    method: "muddle",
    garnish: "Jalapeno slice, Tajin rim",
    abv: 19,
    tags: ["Modern", "Spicy", "Citrusy"],
    source: "Modern Classic",
    year: null,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "mezcal", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "agave nectar", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "simple syrup", qty: 0.75, unit: "oz" }] },
      { food: "jalapeno", qty: 2, unit: "slices", note: "seeds removed for less heat", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Frozen Margarita",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz blanco tequila", "1 oz fresh lime juice", "0.75 oz triple sec", "0.5 oz agave nectar"],
    directions: [
      "Blend all ingredients with 1.5 cups of ice until smooth.",
      "Pour into a margarita glass with a salted rim.",
      "Garnish with a lime wheel."
    ],
    glass: "margarita",
    method: "blend",
    garnish: "Lime wheel, salt rim",
    abv: 14,
    tags: ["Modern", "Citrusy", "Refreshing"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "blanco tequila", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "mezcal", qty: 2, unit: "oz" }] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "triple sec", qty: 0.75, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "cointreau", qty: 0.75, unit: "oz" }] },
      { food: "agave nectar", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Mango Daiquiri",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "1 oz fresh lime juice", "0.75 oz simple syrup", "3 oz mango chunks"],
    directions: [
      "Blend all ingredients with 1 cup of ice until smooth.",
      "Pour into a coupe glass.",
      "Garnish with a mango slice."
    ],
    glass: "coupe",
    method: "blend",
    garnish: "Mango slice",
    abv: 12,
    tags: ["Modern", "Tropical", "Fruity"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "mango", qty: 3, unit: "oz", note: "fresh or frozen chunks", optional: false, substitutes: [] }
    ]
  },

  // ─────────────────────────────────────────────────────────
  // SIMPLE / BEGINNER (~10)
  // ─────────────────────────────────────────────────────────

  {
    name: "Screwdriver",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz vodka", "4 oz orange juice"],
    directions: [
      "Fill a highball glass with ice.",
      "Add vodka and orange juice.",
      "Stir gently and garnish with an orange slice."
    ],
    glass: "highball",
    method: "build",
    garnish: "Orange slice",
    abv: 10,
    tags: ["Easy", "Fruity"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "vodka", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "orange juice", qty: 4, unit: "oz", note: "fresh preferred", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Cape Codder",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz vodka", "4 oz cranberry juice", "0.25 oz fresh lime juice"],
    directions: [
      "Fill a highball glass with ice.",
      "Add vodka, cranberry juice, and lime juice.",
      "Stir gently and garnish with a lime wedge."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lime wedge",
    abv: 10,
    tags: ["Easy", "Fruity"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "vodka", qty: 2, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "cranberry juice", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.25, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Rum & Coke",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz white rum", "4 oz cola"],
    directions: [
      "Fill a highball glass with ice.",
      "Add rum and top with cola.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: null,
    abv: 10,
    tags: ["Easy", "Sweet"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "white rum", qty: 2, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "dark rum", qty: 2, unit: "oz" }] },
      { food: "cola", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Jack & Coke",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz Tennessee whiskey", "4 oz cola"],
    directions: [
      "Fill a highball glass with ice.",
      "Add whiskey and top with cola.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: null,
    abv: 10,
    tags: ["Easy", "Sweet"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "tennessee whiskey", qty: 2, unit: "oz", note: "Jack Daniel's traditional", optional: false,
        substitutes: [{ food: "bourbon", qty: 2, unit: "oz" }] },
      { food: "cola", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "7 & 7",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz Seagram's 7 Crown whiskey", "4 oz 7-Up"],
    directions: [
      "Fill a highball glass with ice.",
      "Add whiskey and top with 7-Up.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lemon wedge",
    abv: 10,
    tags: ["Easy", "Fizzy"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "blended whiskey", qty: 2, unit: "oz", note: "Seagram's 7 traditional", optional: false,
        substitutes: [{ food: "bourbon", qty: 2, unit: "oz" }] },
      { food: "lemon-lime soda", qty: 4, unit: "oz", note: "7-Up or Sprite", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Mimosa",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["3 oz champagne", "3 oz orange juice"],
    directions: [
      "Pour chilled champagne into a champagne flute.",
      "Top with chilled orange juice.",
      "Stir gently if desired."
    ],
    glass: "champagne_flute",
    method: "build",
    garnish: "Orange slice",
    abv: 6,
    tags: ["Easy", "Fruity", "Fizzy"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "champagne", qty: 3, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "prosecco", qty: 3, unit: "oz" }] },
      { food: "orange juice", qty: 3, unit: "oz", note: "fresh preferred", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Bellini",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["4 oz prosecco", "2 oz white peach puree"],
    directions: [
      "Add peach puree to a champagne flute.",
      "Slowly top with chilled prosecco.",
      "Stir very gently to combine."
    ],
    glass: "champagne_flute",
    method: "build",
    garnish: null,
    abv: 7,
    tags: ["Classic", "Fruity", "Fizzy"],
    source: "Simple",
    year: 1948,
    ingredientsStructured: [
      { food: "prosecco", qty: 4, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "champagne", qty: 4, unit: "oz" }] },
      { food: "white peach puree", qty: 2, unit: "oz", note: "fresh or frozen", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Kir Royale",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["4 oz champagne", "0.5 oz creme de cassis"],
    directions: [
      "Pour creme de cassis into a champagne flute.",
      "Slowly top with chilled champagne."
    ],
    glass: "champagne_flute",
    method: "build",
    garnish: "Lemon twist",
    abv: 10,
    tags: ["Classic", "Fruity", "Fizzy"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "champagne", qty: 4, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "prosecco", qty: 4, unit: "oz" }] },
      { food: "creme de cassis", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Shandy",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["6 oz lager beer", "6 oz lemonade"],
    directions: [
      "Pour beer into a highball glass.",
      "Top with equal parts lemonade.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lemon wedge",
    abv: 2,
    tags: ["Easy", "Refreshing", "Fizzy"],
    source: "Simple",
    year: null,
    ingredientsStructured: [
      { food: "lager beer", qty: 6, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "lemonade", qty: 6, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Hugo Spritz",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["3 oz prosecco", "1 oz St-Germain elderflower liqueur", "1 oz club soda", "3 mint leaves"],
    directions: [
      "Fill a wine glass with ice.",
      "Add St-Germain and prosecco.",
      "Top with club soda.",
      "Stir gently and garnish with mint leaves and a lime wedge."
    ],
    glass: "wine",
    method: "build",
    garnish: "Mint leaves, lime wedge",
    abv: 7,
    tags: ["Easy", "Refreshing", "Herbaceous"],
    source: "Simple",
    year: 2005,
    ingredientsStructured: [
      { food: "prosecco", qty: 3, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "st-germain", qty: 1, unit: "oz", note: "elderflower liqueur", optional: false, substitutes: [] },
      { food: "club soda", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "mint leaves", qty: 3, unit: "leaves", note: "fresh", optional: false, substitutes: [] }
    ]
  },

  // ─────────────────────────────────────────────────────────
  // NON-ALCOHOLIC (~5)
  // ─────────────────────────────────────────────────────────

  {
    name: "Virgin Mojito",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz fresh lime juice", "0.75 oz simple syrup", "6 mint leaves", "4 oz club soda"],
    directions: [
      "Gently muddle mint leaves with simple syrup and lime juice in a collins glass.",
      "Fill with crushed ice.",
      "Top with club soda and stir gently.",
      "Garnish with a mint sprig."
    ],
    glass: "collins",
    method: "muddle",
    garnish: "Mint sprig",
    abv: 0,
    tags: ["Virgin", "Refreshing", "Herbaceous"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "mint leaves", qty: 6, unit: "leaves", note: "fresh", optional: false, substitutes: [] },
      { food: "club soda", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Shirley Temple",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["4 oz ginger ale", "2 oz lemon-lime soda", "0.5 oz grenadine"],
    directions: [
      "Fill a highball glass with ice.",
      "Add ginger ale and lemon-lime soda.",
      "Top with grenadine.",
      "Garnish with a maraschino cherry and orange slice."
    ],
    glass: "highball",
    method: "build",
    garnish: "Maraschino cherry, orange slice",
    abv: 0,
    tags: ["Virgin", "Sweet", "Fizzy"],
    source: "Popular",
    year: 1930,
    ingredientsStructured: [
      { food: "ginger ale", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "lemon-lime soda", qty: 2, unit: "oz", note: "Sprite or 7-Up", optional: false, substitutes: [] },
      { food: "grenadine", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Arnold Palmer",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["4 oz iced tea", "4 oz lemonade"],
    directions: [
      "Fill a highball glass with ice.",
      "Pour iced tea and lemonade over ice.",
      "Stir gently."
    ],
    glass: "highball",
    method: "build",
    garnish: "Lemon wedge",
    abv: 0,
    tags: ["Virgin", "Refreshing"],
    source: "Popular",
    year: 1960,
    ingredientsStructured: [
      { food: "iced tea", qty: 4, unit: "oz", note: "unsweetened or lightly sweetened", optional: false, substitutes: [] },
      { food: "lemonade", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Virgin Pina Colada",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["3 oz pineapple juice", "2 oz coconut cream"],
    directions: [
      "Blend pineapple juice and coconut cream with 1 cup of ice until smooth.",
      "Pour into a hurricane glass.",
      "Garnish with a pineapple wedge and cherry."
    ],
    glass: "hurricane",
    method: "blend",
    garnish: "Pineapple wedge, cherry",
    abv: 0,
    tags: ["Virgin", "Tropical", "Creamy"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "pineapple juice", qty: 3, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "coconut cream", qty: 2, unit: "oz", note: "Coco Lopez preferred", optional: false, substitutes: [] }
    ]
  },

  {
    name: "Virgin Mary",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["4 oz tomato juice", "0.5 oz fresh lemon juice", "2 dashes Worcestershire sauce", "2 dashes hot sauce", "1 pinch celery salt", "1 pinch black pepper"],
    directions: [
      "Add all ingredients to a highball glass.",
      "Fill with ice and stir well.",
      "Garnish with a celery stalk, lemon wedge, and olives."
    ],
    glass: "highball",
    method: "build",
    garnish: "Celery stalk, lemon wedge, olives",
    abv: 0,
    tags: ["Virgin", "Spicy"],
    source: "Popular",
    year: null,
    ingredientsStructured: [
      { food: "tomato juice", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lemon juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "worcestershire sauce", qty: 2, unit: "dash", note: null, optional: false, substitutes: [] },
      { food: "hot sauce", qty: 2, unit: "dash", note: "Tabasco or similar", optional: false, substitutes: [] },
      { food: "celery salt", qty: 1, unit: "pinch", note: null, optional: false, substitutes: [] },
      { food: "black pepper", qty: 1, unit: "pinch", note: "freshly ground", optional: false, substitutes: [] }
    ]
  },

  // ─────────────────────────────────────────────────────────
  // BONUS CLASSICS & ESSENTIALS (~5)
  // ─────────────────────────────────────────────────────────

  {
    name: "Vesper Martini",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["3 oz gin", "1 oz vodka", "0.5 oz Lillet Blanc"],
    directions: [
      "Shake all ingredients with ice until ice-cold.",
      "Strain into a chilled martini glass.",
      "Garnish with a large thin lemon peel."
    ],
    glass: "martini",
    method: "shake",
    garnish: "Lemon peel",
    abv: 28,
    tags: ["Classic", "Boozy"],
    source: "Classic",
    year: 1953,
    ingredientsStructured: [
      { food: "gin", qty: 3, unit: "oz", note: "Gordon's in the original", optional: false, substitutes: [] },
      { food: "vodka", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "lillet blanc", qty: 0.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "dry vermouth", qty: 0.5, unit: "oz" }] }
    ]
  },

  {
    name: "Pisco Sour",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["2 oz pisco", "1 oz fresh lime juice", "0.75 oz simple syrup", "1 egg white", "2 dashes Angostura bitters"],
    directions: [
      "Dry shake pisco, lime juice, simple syrup, and egg white without ice.",
      "Add ice and shake again vigorously.",
      "Strain into a coupe glass.",
      "Drop Angostura bitters on the foam in a pattern."
    ],
    glass: "coupe",
    method: "dry_shake",
    garnish: "Angostura bitters drops on foam",
    abv: 16,
    tags: ["Classic", "Sour", "Creamy"],
    source: "Classic",
    year: 1920,
    ingredientsStructured: [
      { food: "pisco", qty: 2, unit: "oz", note: "quebranta grape variety preferred", optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 1, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "fresh lemon juice", qty: 1, unit: "oz" }] },
      { food: "simple syrup", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "egg white", qty: 1, unit: "whole", note: null, optional: false,
        substitutes: [{ food: "aquafaba", qty: 1, unit: "oz" }] },
      { food: "angostura bitters", qty: 2, unit: "dash", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "El Diablo",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz reposado tequila", "0.5 oz creme de cassis", "0.75 oz fresh lime juice", "3 oz ginger beer"],
    directions: [
      "Shake tequila, creme de cassis, and lime juice with ice.",
      "Strain into a highball glass over fresh ice.",
      "Top with ginger beer and stir gently.",
      "Garnish with a lime wheel."
    ],
    glass: "highball",
    method: "shake",
    garnish: "Lime wheel",
    abv: 9,
    tags: ["Classic", "Fruity", "Refreshing"],
    source: "Classic",
    year: 1946,
    ingredientsStructured: [
      { food: "reposado tequila", qty: 1.5, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "blanco tequila", qty: 1.5, unit: "oz" }] },
      { food: "creme de cassis", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "ginger beer", qty: 3, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Suffering Bastard",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1 oz bourbon", "1 oz gin", "0.5 oz fresh lime juice", "1 dash Angostura bitters", "4 oz ginger beer"],
    directions: [
      "Shake bourbon, gin, lime juice, and bitters with ice.",
      "Strain into a collins glass over fresh ice.",
      "Top with ginger beer.",
      "Garnish with a mint sprig and orange slice."
    ],
    glass: "collins",
    method: "shake",
    garnish: "Mint sprig, orange slice",
    abv: 10,
    tags: ["Classic", "Refreshing"],
    source: "Classic",
    year: 1942,
    ingredientsStructured: [
      { food: "bourbon", qty: 1, unit: "oz", note: null, optional: false,
        substitutes: [{ food: "rye whiskey", qty: 1, unit: "oz" }] },
      { food: "gin", qty: 1, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "angostura bitters", qty: 1, unit: "dash", note: null, optional: false, substitutes: [] },
      { food: "ginger beer", qty: 4, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  },

  {
    name: "Chartreuse Swizzle",
    itemType: "drink",
    _type: "drink",
    type: "drink",
    ingredients: ["1.5 oz green Chartreuse", "0.5 oz velvet falernum", "0.75 oz pineapple juice", "0.75 oz fresh lime juice"],
    directions: [
      "Add all ingredients to a highball glass.",
      "Fill with crushed ice and swizzle until the glass is frosted.",
      "Top with more crushed ice.",
      "Garnish with a mint bouquet and freshly grated nutmeg."
    ],
    glass: "highball",
    method: "build",
    garnish: "Mint bouquet, nutmeg",
    abv: 18,
    tags: ["Modern", "Herbaceous", "Tropical"],
    source: "Modern Classic",
    year: 2003,
    ingredientsStructured: [
      { food: "green chartreuse", qty: 1.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "velvet falernum", qty: 0.5, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "pineapple juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] },
      { food: "fresh lime juice", qty: 0.75, unit: "oz", note: null, optional: false, substitutes: [] }
    ]
  }
];

export const SEED_COCKTAIL_COUNT = SEED_COCKTAILS.length;
export default SEED_COCKTAILS;
