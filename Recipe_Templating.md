In Paprika Recipe Manager 3, these libraries form a cohesive pipeline that handles a recipe's journey from a raw website URL to a structured, searchable entry in your local database.

Here is how they work together:

1. The Ingestion Phase (Scraping & Parsing)
When you "clip" a recipe from a website, the application uses a multi-layered approach:

AngleSharp: This is the "brain" of the web scraper. It parses the raw HTML of a webpage into a navigable DOM tree. It allows the app to query the page for specific elements (like finding the ingredients list or instructions block) even if the website is messy or uses modern HTML5 features.
Newtonsoft.Json: Most modern recipe sites use JSON-LD (structured data) to help search engines. Paprika uses Newtonsoft.Json to extract these structured JSON blobs directly from the HTML parsed by AngleSharp. This is often more reliable than scraping raw text because the data is already organized into "name," "ingredients," and "recipeInstructions" fields.
YamlDotNet: This is likely used for interoperability with other recipe formats or older data exports that utilize YAML for its human-readable structure.
2. The Storage Phase (Persistence)
Once the data is extracted, it needs to be saved permanently:

Microsoft.Data.Sqlite: This acts as the local engine for the app's database. The C# Recipe models are mapped to SQL tables. When you save a recipe, the app runs SQL commands to store the text data (name, cook time, etc.) into a .db file on your hard drive.
Newtonsoft.Json (Internal Storage): For fields that are too complex for a standard SQL column (like a list of photo metadata, category IDs, or synchronization flags), Paprika serializes these objects into JSON strings and stores them inside a single TEXT column in the SQLite database.
3. The Presentation Phase (Rendering & UI)
When you click on a recipe to view it, the process reverses:

Mustache: This is a logic-less templating engine used for the UI. Instead of hard-coding the HTML for the recipe view, Paprika has a template file (e.g., recipe-content.html).
The app loads the recipe from SQLite.
It converts the recipe object into a data dictionary using Newtonsoft.Json.
Mustache takes that dictionary and injects the values into the HTML template.
The final rendered HTML is then displayed in the app's internal browser (CefSharp).
Summary Data Flow
mermaid
graph TD
    Web[Website/URL] -->|HTML| AS[AngleSharp]
    AS -->|Extract JSON-LD| NJ[Newtonsoft.Json]
    AS -->|DOM Selection| RM[Recipe Model]
    NJ -->|Object Mapping| RM
    
    RM -->|SQL Insert| SQLite[(SQLite Database)]
    SQLite -->|SQL Query| RM
    
    RM -->|Serialize| Dict[Data Dictionary]
    Dict -->|Template Merge| Must[Mustache]
    Must -->|Rendered HTML| UI[User Interface]
This architecture ensures that the application is flexible (can handle many different websites), performant (SQLite is very fast for local lookups), and customizable (Mustache allows the developers to change the look of the recipe view without rewriting the C# logic).

The templating information is stored in a set of HTML and TXT files prefixed with Paprika.Windows.Resources.Templates. These files use Mustache syntax (like {{name}} or {{#has_ingredients}}) to define how the data from the C# models is rendered for the user.

1. Recipe Templates (The Core View)
These files define how recipes look when you view, print, or export them:


recipe-content.html
: The primary template for the main recipe view. It includes logic for images, ratings, ingredients, and directions.

recipe-display.html
: Used for displaying recipe summaries or lists.

recipe-print.html
: A specialized template optimized for physical printing.

recipe-text.txt
: A plain-text version of a recipe (used for sharing or "copy as text").

recipe-index-card.html
: A layout styled like a traditional physical recipe card.
2. Grocery & Pantry Templates

grocery-list.html
: Defines the layout of your shopping list.

grocery-list.txt
: The text-only version of the shopping list.

pantry.html
: The layout for the pantry inventory view.
3. Planning & Organization Templates

meals.html
 / 

meals.txt
: Templates for the meal planner/calendar.

menu.html
 / 

menu.txt
: Templates for pre-defined menus.
4. Supporting Templates

nutrition.html
: A partial template specifically for rendering the nutritional data table.

photo_gallery.html
: Handles the layout for multiple recipe photos.

markdown-help.html
: The help document showing users how to use markdown in their notes.