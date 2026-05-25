The files related to recipe templating (export format rendering) and recipe imports/migrations in the Mealie codebase are categorized below by their domain and function.

1. Recipe Templating & Exports (Backend)
These files handle recipe rendering and template-based exports (e.g., raw JSON or ZIP templates containing recipe data and image assets):

mealie/services/recipe/template_service.py
 Implements the TemplateService and defines the TemplateType enumeration (json / zip). It handles rendering recipes into raw JSON or standard ZIP bundles (including the original webp image asset).
mealie/routes/recipe/exports.py
 Defines the API routing endpoints /api/recipes/exports (to list available templates) and /api/recipes/{slug}/exports (to download the recipe rendered via the requested template).
mealie/services/recipe/recipe_service.py
 Contains helper methods like render_template that instantiate the TemplateService and coordinate the temp-file rendering, as well as create_from_zip to parse imported ZIP bundles.
2. Recipe Imports & Migrations (Backend)
These files handle importing recipe data from external recipe managers (e.g., Paprika, Tandoor, Chowdown) or bulk imports:

mealie/routes/groups/controller_migrations.py
 Exposes the API endpoint /api/groups/migrations which processes uploaded backup files and maps migration requests to their respective migrator class.
mealie/schema/group/group_migration.py
 Defines the supported migration platforms via the SupportedMigrations enum.
mealie/services/migrations/_migration_base.py
 Provides the abstract BaseMigrator class with shared utilities for cleaning and validating recipe dicts, persisting records, downloading images, and writing execution report summaries.
mealie/services/migrations/
 (Individual Migrators) Each file implements import strategies specific to a source recipe platform:
chowdown.py
cookn.py
copymethat.py
mealie_alpha.py
myrecipebox.py
nextcloud.py
paprika.py
plantoeat.py
recipekeeper.py
tandoor.py
mealie/services/migrations/utils/
 (Migration Helpers)
database_helpers.py (resolving or seeding category/tag entities in DB)
migration_alias.py (mappings from source schema keys to Mealie schema keys)
migration_helpers.py (file readers, ZIP path traversers, and duration parsers)
3. Frontend Views & API Utilities
These files implement the user interface and API bindings for importing external data:

frontend/pages/group/migrations.vue
 The UI component allowing users to upload data files and trigger external imports.
frontend/lib/api/user/group-migrations.ts
 API client wrapper function that interacts with the backend migrations controller.
frontend/composables/use-bulk-import-polling.ts
 A Vue composable handling background status polling for active import/migration tasks.
4. Tests
These files verify that imports and template rendering produce correct outputs:

tests/unit_tests/test_recipe_export_types.py
 Unit tests targeting the TemplateService types.
tests/integration_tests/user_recipe_tests/test_recipe_export_as.py
 Integration tests confirming that users can fetch export templates and download rendered files.
tests/integration_tests/user_recipe_tests/test_recipe_bulk_import.py
 Integration tests confirming bulk URL imports succeed.
Summary of Work
I scanned the repository to locate all backend services, schemas, route controllers, frontend layouts, and test fixtures associated with recipe export templates and external import migrations. All the key files have been located and mapped out above. Let me know if you would like me to unpack or modify any of these specific modules.

1:21 PM, 5/21/2026



Summarize these files in technical detail for a developer looking to understand the process of how the meal data is imported cleanly
8:28 AM


For a developer looking to understand or extend Mealie's import/migration architecture, here is a detailed technical walkthrough of the process.

Mealie uses a pipeline to handle imports from various external recipe managers (e.g., Paprika, Tandoor, Nextcloud) and bulk imports. The import system ensures raw, chaotic external formats are normalized, validated, and safely written to the database without causing transaction-wide failures.

The Import & Migration Architecture
Mermaid diagram
Phase 1: Controller & Migrator Orchestration
1. Route Entry (mealie/routes/groups/controller_migrations.py)
The frontend uploads a file (ZIP or backup bundle) to /api/groups/migrations along with form parameters: add_migration_tag (boolean) and migration_type (matching a value from the SupportedMigrations enum).
The controller writes the incoming stream to a temporary path via a context manager get_temporary_zip_path().
It references a routing dictionary mapping the SupportedMigrations enum directly to a concrete class subclassing BaseMigrator (e.g., PaprikaMigrator, MealieAlphaMigrator).
The concrete migrator is initialized with context wrappers, database repository accessors (self.repos), active database sessions (self.session), household preferences, and localized string translators.
2. The Migration Lifecycle (mealie/services/migrations/_migration_base.py)
BaseMigrator manages the lifecycle of the import:
Report Registration: Calls _create_report() to insert an active migration record into the database, initializing it to in_progress.
Migration Run: Invokes the abstract _migrate() method implemented by the subclass.
Completion & Logs: Saves individual recipe success/fail messages and finalizes the overall migration status (success, partial, or failure) before saving state to group_reports via _save_all_entries().
Phase 2: Schema Mapping via MigrationAlias
Each migrator defines a list of MigrationAlias mapping objects inside self.key_aliases.

python


MigrationAlias(key="recipeIngredient", alias="ingredients", func=lambda x: x.split("\n") if x else "")
Attribute Mapping: Extracts the vendor-specific key (e.g., ingredients, cook_time) from the parsed document, processes the value, and maps it to Mealie's standardized database schema fields (recipeIngredient, performTime).
Transformation Callbacks (func): Allows inline transformations (e.g., splitting single newline-delimited ingredient block strings into standard lists, parsing custom ISO-8601 durations, or stripping numbered prefixes from step strings using regex).
Phase 3: Data Standardization & Cleaning (mealie/services/scraper/cleaner.py)
Once fields are mapped, the dictionary is cleaned and sanitized via cleaner.clean(). This is the core logic that ensures imports are clean:

1. String Sanitization (clean_string)
Unescapes HTML entities (e.g., &amp; → &).
Strips all raw HTML tags using regex: MATCH_HTML_TAGS = re.compile(r"<[^<]+?>").
Normalizes excess horizontal spaces and strips empty lines, converting trailing paragraph tags into standard line breaks.
2. Time & Duration Normalization (clean_time)
Supports multiple time inputs (strings like "PT1H30M", integer/float values representing raw minutes, or timedelta instances).
Invokes parse_duration to parse ISO-8601 strings into a Python timedelta, utilizing the isodate parsing fallback library.
Standardizes these durations into descriptive, localized, and human-readable strings (e.g., "1 hour 30 minutes") using pretty_print_timedelta.
3. Yield & Servings Extraction (clean_yield)
Takes messy strings like ["4 servings", "4 Pies"] and parses out numerical quantities.
Interrogates unit keywords (checks if the unit matches a known translation for "serves", "yields", "makes", etc.) using the localized Translator.
Returns a structured tuple: (servings_qty: float, yield_qty: float, yield_unit: str).
4. Instruction Steps (clean_instructions)
Standardizes step data. It pattern-matches standard formats to uniform objects:

List of Strings: Converted to {"text": "..."}.
Indexed Dictionary: Resolves index keys (integer or string keys) into ordered arrays.
HowToSection/HowToStep Nodes: Flattens nested Schema.org JSON-LD arrays into continuous instruction steps.
Each instruction string goes through an optimization loop that executes clean_string recursively until the text returns a stable string.
5. Validation
The fully-standardized dictionary is passed to Mealie's Pydantic Recipe model (mealie/schema/recipe/recipe.py). This guarantees type alignment and constraints before any DB interaction occurs.
Phase 4: Database Insertion & Asset Management
1. Entity Checking & Seeding (BaseMigrator.import_recipes_to_database)
Default Settings: Applies global target household preferences (e.g., setting recipe visibility to public/private, applying comment policy, or hiding nutrition fields by default).
Tag & Category Synchronization: Rather than bulk inserting raw category or tag strings, it calls self.helpers.get_or_set_category / get_or_set_tags. If a category name (e.g., "Dessert") exists in the group's taxonomy, it resolves the relational ID; if not, it inserts the new record, avoiding database duplicates.
Migration Tagging: If requested, it tags the imported recipes with the name of the migration platform (e.g. "Paprika") for easy search filtering later.
2. Fault Tolerance per Recipe
Recipes are processed inside a loop. If a single recipe fails validation or DB constraints, the migrator logs the exact exception, issues a self.session.rollback(), and gracefully moves to the next recipe. A single corrupt schema will not crash the entire bulk import.
3. Disk Media Assets Write (import_image)
If the recipe import includes an associated image (represented as base64 strings in some exports, or absolute file paths in others), the migrator:
Decodes or extracts the file into a temporary location.
Uses RecipeDataService(recipe_id) to handle saving the original binary onto the server's local file storage system in its proper subdirectory, skipping any intermediate network fetch.
Summary of Work
I performed a technical analysis of Mealie's backend import system, detailing the lifecycle of an import from the frontend API controller to database normalization. I documented the role of MigrationAlias, mapped the cleaning and parsing strategies defined in cleaner.py, and highlighted how database transactions remain robust through individual rollbacks and taxonomic seeding.