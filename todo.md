You are an experienced full-stack web developer and product designer. Build a complete, production-quality web application called Meal Planner.

The purpose of the application is to let a user collect recipes from Finnish recipe websites, organize them into meal plans, automatically generate shopping lists, and estimate nutritional information for the planned meals.

This should be a real, functional web application — not a mockup or a prototype with hardcoded data.

1. Core concept

The application should allow the user to:

1. Browse and search a large recipe catalogue.
2. Add recipes to a personal recipe collection.
3. Import recipes directly from URLs.
4. Specifically support recipes from:
    * K-Ruoka
    * Yhteishyvä / S-kaupat recipe pages
    * Valio
5. Parse the recipe page and extract:
    * Recipe name
    * Description
    * Ingredients
    * Ingredient quantities
    * Units
    * Number of servings
    * Preparation instructions
    * Preparation time
    * Cooking time
    * Images where legally/technically appropriate
    * Nutrition information if provided by the source
6. Build a meal plan for a day, week, or arbitrary date range.
7. Automatically generate a consolidated shopping list from the meal plan.
8. Calculate estimated nutritional information for meals and days.
9. Handle imperfect ingredient/product matching intelligently.
10. Allow the user to manually correct ingredient mappings when necessary.

The application should be designed around Finnish users and Finnish food products, but the architecture should not unnecessarily prevent future internationalization.

⸻

2. Recipe URL importing

One of the most important features is importing recipes from URLs.

The user should be able to paste multiple URLs, for example:

https://www.k-ruoka.fi/reseptit/texmex-salaatti

https://yhteishyva.fi/reseptit/marry-me-keitto/7EDLGkBh6ltuuGI38fTrob

https://www.valio.fi/reseptit/maukas-kasvislasagne/

The application should fetch the pages and extract the relevant recipe information.

Do NOT make the parser dependent on one specific HTML structure if avoidable.

Implement a robust extraction pipeline:

1. Identify the website/domain.
2. Use a site-specific parser if one exists.
3. Fall back to structured data such as Schema.org Recipe JSON-LD.
4. Fall back to semantic HTML extraction.
5. Normalize the resulting recipe into the application’s internal recipe format.
6. Report fields that could not be extracted.

Prefer structured recipe metadata such as:

application/ld+json

and Schema.org Recipe objects whenever available.

The parser should be designed so additional Finnish recipe sites can be added later without rewriting the entire application.

Create a clean adapter architecture, for example:

RecipeSourceAdapter

* KRuokaAdapter
* YhteishyvaAdapter
* ValioAdapter
* GenericRecipeAdapter

The exact architecture is up to you, but maintainability is important.

Do not silently invent recipe data when parsing fails.

If a recipe cannot be parsed completely, show the user what was successfully extracted and allow manual correction.

⸻

3. Recipe catalogue

The application should not only depend on URLs manually entered by the user.

Create a recipe catalogue architecture capable of containing a very large number of recipes.

Investigate whether there are legally and technically usable public recipe datasets, APIs, open recipe databases, or other suitable sources that can provide a large initial recipe catalogue.

Prioritize:

* Finnish recipes
* Finnish ingredients
* Recipes with structured ingredient lists
* Sources with clear licensing/usage terms
* APIs or downloadable datasets where possible

Do not scrape enormous amounts of copyrighted recipe content blindly.

Separate:

* recipe metadata
* recipe source URL
* ingredient data
* user-created recipes
* imported recipes

If a suitable public recipe catalogue cannot legally be bundled into the project, create the architecture for importing one later and include a small seed dataset for development.

The application should also support user-added recipes.

⸻

4. Ingredient normalization

Ingredient normalization is a major part of this application.

Different recipes may refer to the same ingredient in different ways:

* “kanasuikale”
* “broilerin suikale”
* “broilerin fileesuikale”
* “kanafileesuikale”

or:

* “maito”
* “kevytmaito”
* “rasvaton maito”

or:

* “spagetti”
* “täysjyväspagetti”

The application should normalize ingredients into canonical ingredient entities while retaining the original recipe wording.

For example:

Recipe ingredient:

“200 g broilerin fileesuikaleita”

could map to:

Canonical ingredient:
“Chicken breast strips”

with:

quantity = 200
unit = g

The mapping does NOT need to be perfect.

A good approximate match is preferable to failing completely.

Maintain a confidence score for ingredient mappings.

For example:

* Exact match: 1.0
* Very strong semantic match: 0.9
* Reasonable generic substitution: 0.7
* Weak approximation: 0.5
* Unknown: 0.0

Display low-confidence mappings to the user when appropriate.

Allow the user to manually change the mapped ingredient.

⸻

5. Fineli nutrition data

Use the Finnish Institute for Health and Welfare’s Fineli open food data as the primary nutrition database:

https://fineli.fi/fineli/fi/avoin-data

The application should use Fineli data for estimating nutrition.

Investigate the actual available Fineli data format and implement an importer/parser rather than manually entering nutritional values.

The application should ideally maintain a local normalized nutrition database derived from the Fineli open dataset.

Do not require an external API request for every ingredient.

Import the relevant Fineli data during development/build/setup and store it in the application’s local database.

The nutrition model should support at least:

* Energy / kcal
* Protein
* Carbohydrates
* Fat
* Fibre
* Sugars
* Saturated fat
* Salt / sodium where available

Include additional Fineli nutritional fields when practical.

⸻

6. Approximate nutrition matching

Nutrition matching does NOT have to be 100% accurate.

This is an estimation tool.

For example, if a recipe contains:

“200 g broilerin fileesuikaleita”

and the exact branded product cannot be found in Fineli, use an appropriate generic food such as:

“Chicken breast”

rather than returning zero nutritional information.

Similarly:

“Valio kevytmaito”

can reasonably map to a generic semi-skimmed milk if the exact product is unavailable.

The matching process should consider:

* ingredient name
* synonyms
* Finnish terminology
* common abbreviations
* ingredient category
* preparation state
* fat percentage
* raw vs cooked
* approximate product type

Do not make obviously bad substitutions.

For example:

“olive oil” must not map to “olives”.

“cream cheese” should not map to ordinary milk.

“wholegrain pasta” should preferably map to wholegrain pasta rather than ordinary pasta.

Store:

original ingredient
→ normalized ingredient
→ Fineli food
→ confidence

This makes the system auditable.

⸻

7. Nutrition calculations

Calculate nutritional values based on ingredient quantities.

For each ingredient:

nutrition per 100 g/ml
× recipe quantity
÷ 100

Then aggregate all ingredients.

Account for:

* grams
* kilograms
* millilitres
* litres
* tablespoons
* teaspoons
* pieces
* eggs
* cloves
* cans
* packages
* other common Finnish recipe units

For units that cannot be converted precisely, use reasonable standard approximations.

Keep the conversion system extensible.

For example:

1 tbsp oil ≈ 15 ml

1 tsp oil ≈ 5 ml

1 egg ≈ an appropriate standard edible weight

Do not pretend these conversions are exact.

⸻

8. Daily and weekly nutrition

The user should be able to see nutrition at several levels.

Recipe:

Calories
Protein
Carbohydrates
Fat
Fibre
etc.

Meal:

Aggregate recipe nutrition.

Day:

Aggregate all meals.

Week:

Aggregate all days.

Also display daily averages.

Example:

Monday

2,140 kcal
142 g protein
220 g carbohydrates
71 g fat
31 g fibre

The UI should clearly indicate that these are estimates.

If ingredient matching is uncertain, provide a small indication such as:

“Estimated nutrition — 87% of ingredients confidently matched”

Do not overwhelm the interface with technical details unless the user opens the nutrition details.

⸻

9. Meal planning

Create a calendar-style meal planner.

The user should be able to assign recipes to:

* Breakfast
* Lunch
* Dinner
* Snack
* Other

The user should be able to create a weekly plan.

Example:

Monday
Breakfast — Omelette
Lunch — Chicken pasta
Dinner — Vegetable lasagna

Tuesday
Breakfast — …
Lunch — …
Dinner — …

Allow the user to:

* drag recipes between days
* duplicate meals
* remove meals
* change servings
* add multiple recipes to one meal
* leave meals empty
* reuse a recipe multiple times

Serving count matters.

If a recipe is normally 4 servings but the user plans it for 2 servings, nutrition and shopping quantities should scale accordingly.

⸻

10. Shopping list generation

Generate a consolidated shopping list from the meal plan.

For example:

Meal 1:
200 g chicken
1 onion
2 dl cream

Meal 2:
300 g chicken
1 onion
5 dl cream

Shopping list:

Chicken — 500 g
Onion — 2 pcs
Cream — 7 dl

The system should intelligently merge ingredients.

Normalize units when possible.

For example:

500 g + 0.5 kg = 1 kg

but avoid dangerous or nonsensical conversions.

Group the shopping list into useful categories:

* Vegetables & fruit
* Meat & fish
* Dairy
* Bakery
* Dry goods
* Frozen
* Canned goods
* Spices & sauces
* Other

Allow the user to manually change the category.

Shopping list items should be checkable.

Remember checked state.

⸻

11. Product vs ingredient distinction

Important:

Do not confuse a recipe ingredient with a supermarket product.

For example:

Recipe:
“2 dl cream”

Shopping list could show:

“Cooking cream — 2 dl”

but nutrition matching may use:

“Cooking cream, generic”

These should be separate concepts.

Create a normalized ingredient model that can eventually support:

Ingredient
→ Food/Nutrition entity
→ Optional supermarket product

This allows future integration with grocery store product databases without redesigning the application.

⸻

12. Recipe scaling

Recipes must be scalable.

If the source recipe serves 4 and the user selects 6:

200 g chicken
→ 300 g

2 dl cream
→ 3 dl

The application should scale all quantitative ingredients automatically.

Be careful with ingredients such as:

* salt
* spices
* eggs
* baking powder
* yeast

Simple mathematical scaling is acceptable initially, but allow exceptions in the data model.

⸻

13. User experience

The UI should feel like a polished modern consumer application rather than an admin dashboard.

Prioritize:

* fast interaction
* clear hierarchy
* good typography
* responsive layout
* mobile-friendly design
* desktop-friendly weekly planning

Main sections:

Dashboard
Recipes
Meal Planner
Shopping List
Nutrition
Settings

The dashboard could show:

Today’s meals
Today’s estimated nutrition
Current meal plan
Shopping list progress
Recently imported recipes

⸻

14. Recipe detail page

A recipe detail page should contain:

Recipe image
Recipe title
Description
Source
Preparation time
Cooking time
Servings
Ingredients
Instructions
Nutrition
Add to meal plan
Add to favourites

For imported recipes, clearly identify the original source.

Keep source attribution and original URL.

Do not unnecessarily reproduce copyrighted recipe text outside the context where the user imported it.

⸻

15. Data model

Design a proper database schema.

At minimum, consider entities such as:

User
Recipe
RecipeSource
RecipeIngredient
Ingredient
IngredientAlias
NutritionFood
NutritionMapping
MealPlan
Meal
ShoppingList
ShoppingListItem
Favourite
Unit
UnitConversion

The exact schema is up to you.

Use a local-first architecture if practical.

For an initial single-user web application, browser-local persistence is acceptable.

Prefer IndexedDB over localStorage for substantial structured data.

If you choose another architecture, explain why in the project documentation.

The application should work without requiring a backend unless a backend is genuinely necessary.

⸻

16. Technology

Choose a modern, maintainable stack.

A reasonable starting point would be:

* React
* TypeScript
* Vite or Next.js
* Tailwind CSS
* IndexedDB / Dexie
* Zod for validation

But do not blindly follow this list.

Choose the architecture that best fits the requirements.

Avoid unnecessary complexity.

Do not introduce a backend, authentication system, cloud database, Docker stack, Redis, Kubernetes, etc. unless there is a concrete reason.

This is primarily a personal/local meal planning tool.

⸻

17. Importing external web pages

Browser CORS restrictions may prevent the frontend from directly fetching arbitrary recipe pages.

Handle this properly.

If a backend/proxy is necessary for URL importing, create the smallest possible service responsible for fetching and parsing recipe pages.

Do not build a generic unrestricted open proxy.

Restrict fetching to supported recipe domains or implement appropriate SSRF protections.

Validate URLs.

Block:

* localhost
* private IP ranges
* loopback
* link-local addresses
* internal network addresses
* non-HTTP(S) protocols

The importer should have sensible request timeouts and response size limits.

⸻

18. Finnish language

The primary UI language should be Finnish.

Use proper Finnish terminology.

Examples:

Ruokalista
Reseptit
Ostoslista
Ravintosisältö
Proteiini
Hiilihydraatit
Rasva
Kuitu
Kalorit
Annos
Ainekset
Valmistusohje
Valmistusaika

Keep the internal code and data model in English where practical.

Do not mix Finnish and English randomly in the user interface.

⸻

19. Nutrition visualization

Provide useful visualizations without turning the application into a dashboard overloaded with charts.

For example:

Daily nutrition summary:

Calories
██████████████░░ 2,140 / 2,500 kcal

Protein
████████████████░ 142 g

Carbohydrates
██████████████░░░ 220 g

Fat
███████████░░░░░ 71 g

Fibre
████████████░░░░ 31 g

Allow the user to optionally configure daily nutrition targets.

Do not hardcode medical or dietary recommendations.

⸻

20. Recipe search

Implement recipe search across the local catalogue.

Search should work across:

* recipe name
* ingredients
* description
* tags
* cuisine/category

Support filters such as:

* vegetarian
* vegan
* high protein
* low calorie
* quick recipes
* preparation time
* ingredient availability

Nutrition-based filters should use estimated values and clearly indicate that they are estimates.

⸻

21. Intelligent ingredient substitutions

When an exact ingredient is unavailable, use a sensible generic replacement for nutrition estimation.

Examples:

“Valio kevytmaito”
→ “Semi-skimmed milk”

“Rainbow kanafileesuikale”
→ “Chicken breast”

“Mutti tomaattimurska”
→ “Canned crushed tomatoes”

“Fazer kauraleipä”
→ “Oat bread”

This is an estimation system, not an exact product database.

Store the mapping so the user can inspect or override it.

⸻

22. Import diagnostics

When importing a recipe, show an import result.

Example:

Recipe imported successfully.

Detected:
✓ Recipe name
✓ 14 ingredients
✓ 6 preparation steps
✓ 4 servings
✓ Preparation time

Nutrition:
✓ 12 / 14 ingredients matched
⚠ 2 ingredients approximated

Potentially ambiguous ingredients:

“1 pkt taco seasoning”
→ Generic taco seasoning
Confidence: 72%

Allow the user to correct these mappings.

⸻

23. Offline-first behaviour

The application should remain usable after the initial page load.

Recipe data, meal plans, shopping lists and nutrition data should be persisted locally.

If the application is implemented as a PWA, support installation on desktop/mobile.

Do not make cloud synchronization a requirement for the initial version.

⸻

24. Privacy

Meal plans and personal data should remain local by default.

Do not send the user’s meal plans or personal dietary information to third-party analytics systems.

If external services are used for recipe importing or other functionality, make this explicit.

⸻

25. Data import/export

Implement data export.

The user should be able to export their data to JSON.

The user should be able to import a previously exported JSON file.

This should include:

* recipes
* meal plans
* favourites
* ingredient mappings
* shopping lists
* user settings

Use a versioned export format so future schema changes can be handled.

Example:

{
“format”: “meal-planner”,
“version”: 1,
…
}

⸻

26. Development seed data

Create useful seed data so the application is immediately usable during development.

Include a reasonable number of example recipes representing Finnish food.

Do not create hundreds of fake recipes merely to make the application look populated.

Instead, create a clean mechanism for importing a real recipe dataset later.

⸻

27. Important implementation principle

Do not fake functionality.

If something cannot be implemented reliably in the browser, implement the correct architecture for it.

Do not create buttons that merely display:

“Coming soon”

unless the feature genuinely depends on an external service that cannot reasonably be implemented yet.

Prioritize working functionality over visual decoration.

⸻

28. Project documentation

Create a comprehensive README containing:

* What the application does
* Architecture
* Technology stack
* Database/data model
* How Fineli data is imported
* How recipe importing works
* Supported recipe sites
* How to add another recipe source
* How nutrition matching works
* How to run locally
* How to build
* How to run tests
* Data licensing considerations
* Known limitations

Document any external data sources and their licensing/attribution requirements.

⸻

29. Testing

Add automated tests for the important parts of the system.

At minimum test:

Recipe parsing
Ingredient normalization
Unit conversion
Recipe scaling
Nutrition calculation
Ingredient-to-Fineli matching
Shopping list aggregation
Data import/export

Include realistic Finnish ingredient examples.

Especially test cases such as:

“2 dl kevytmaitoa”
“500 g broilerin fileesuikaleita”
“1 sipuli”
“2 rkl oliiviöljyä”
“1 pkt tomaattimurskaa”
“3 kananmunaa”

Test that mathematically equivalent units are correctly combined where possible.

⸻

30. Implementation workflow

Work incrementally.

First inspect the project and determine the existing structure.

Then:

1. Establish the application architecture.
2. Implement the data model.
3. Implement local persistence.
4. Implement recipe normalization.
5. Implement Fineli data import.
6. Implement nutrition matching.
7. Implement recipe URL importing.
8. Implement the recipe catalogue.
9. Implement meal planning.
10. Implement shopping list generation.
11. Implement nutrition views.
12. Implement import/export.
13. Add testing.
14. Polish the UI.

Do not spend most of the effort creating a beautiful UI before the underlying data model and functionality work.

⸻

31. External research

Before implementing integrations, actually inspect the current public formats and documentation for:

Fineli open data:
https://fineli.fi/fineli/fi/avoin-data

K-Ruoka:
https://www.k-ruoka.fi/

Yhteishyvä:
https://yhteishyva.fi/

Valio:
https://www.valio.fi/

Determine how recipe information is currently exposed.

Prefer structured data over brittle CSS selectors.

If the websites use Schema.org JSON-LD, use it.

If a source has an API or other official machine-readable mechanism, prefer that over scraping.

Do not assume the websites’ HTML structure based on these example URLs alone.

⸻

32. Legal and technical constraints

Treat external recipe websites as sources of recipe metadata, not as content that can automatically be republished wholesale.

Preserve source attribution.

Store the original source URL.

Do not copy large amounts of copyrighted prose into a bundled recipe catalogue unless the source explicitly permits it.

The application’s own user-imported recipe data can be stored locally for the user’s use.

Clearly document these assumptions in the README.

⸻

33. Future extensibility

Design the system so future features can be added without major rewrites:

* grocery store product matching
* Prisma/SQLite/PostgreSQL backend
* multi-device synchronization
* user accounts
* household sharing
* dietary restrictions
* allergy filtering
* price estimation
* grocery store shopping lists
* barcode scanning
* AI-assisted recipe normalization
* AI-assisted ingredient substitutions
* automatic weekly meal planning

Do not implement these features now unless required by the core application.

The current goal is a robust personal meal-planning application.

⸻

34. Final quality bar

The finished application should feel like a real product.

It should be possible to:

1. Paste a K-Ruoka, Yhteishyvä or Valio recipe URL.
2. Import the recipe.
3. Inspect and correct its ingredients.
4. Match ingredients against Fineli.
5. See estimated nutritional values.
6. Add the recipe to a weekly meal plan.
7. Scale the recipe for the desired number of people.
8. Automatically generate a consolidated shopping list.
9. Check items off while shopping.
10. Export the entire application data set.

The most important principle is:

The application should produce useful, explainable estimates even when the underlying Finnish food/product data is imperfect.

Accuracy is desirable, but graceful approximation is better than missing data.

Start by inspecting the current project and then implement the application. Do not merely describe how it could be built — build it.