# Ateriasuunnittelija – Meal Planner

A local-first web application for Finnish home cooks: collect recipes (including
importing them from **K-Ruoka**, **Yhteishyvä / S-kaupat** and **Valio** recipe pages),
plan meals on a calendar, get an automatically consolidated shopping list, and see
**estimated nutrition** calculated from the Finnish Institute for Health and Welfare's
open **Fineli** food composition data.

The UI is in Finnish; code and data model are in English.

> The guiding principle: produce useful, *explainable* estimates even when the
> underlying food/product data is imperfect. Every ingredient keeps its original
> wording, its normalized ingredient, the Fineli food used and a confidence score.

---

See also [REVIEW.md](REVIEW.md) – product-owner, customer and security review with decisions.

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Architecture](#architecture)
4. [Technology stack](#technology-stack)
5. [Data model](#data-model)
6. [Fineli data import](#fineli-data-import)
   - [Supplementary food data](#supplementary-food-data)
7. [Recipe catalogue](#recipe-catalogue)
8. [Recipe importing](#recipe-importing)
9. [Supported recipe sites](#supported-recipe-sites)
10. [Adding another recipe source](#adding-another-recipe-source)
11. [Ingredient normalization and nutrition matching](#ingredient-normalization-and-nutrition-matching)
12. [Units, scaling and nutrition calculation](#units-scaling-and-nutrition-calculation)
13. [Shopping list](#shopping-list)
14. [Import / export format](#import--export-format)
15. [Privacy and security](#privacy-and-security)
16. [Testing](#testing)
17. [Data licensing considerations](#data-licensing-considerations)
18. [Known limitations](#known-limitations)
19. [Future extensibility](#future-extensibility)

---

## Features

| Area | What works |
|---|---|
| **Etusivu** (dashboard) | Today's meals and estimated nutrition, week overview, shopping progress, recently imported recipes, "create example week" for a quick start |
| **Reseptit** | Own recipes, favourites, and a ~1 500-dish Fineli catalogue. Search across name, ingredients, description, tags and category, with Finnish inflections handled. Search includes ingredient synonyms ("kana" finds "broilerin fileesuikale"). Filters: vegetarian, vegan, high protein\*, light\*, quick, gluten-free\*, milk-free\*, lactose-free\*, max preparation time, "ingredients at home". \* = based on estimates |
| **Recipe page** | Scalable servings, grouped ingredients with confidence dots, instructions, per-serving/total nutrition, a full nutrient table, per-ingredient contributions, source attribution, import report. Your own **1–5 star rating** (used for sorting, the "★ 4+" filter and by the planner). Actions: add to meal plan, **add straight to a shopping list**, favourite, add to own recipes, **personal notes**, **print**, and **cooking mode** (large text, tick-off steps, screen kept awake via the Wake Lock API). Estimated **gluten-free / milk-free / lactose-free** badges |
| **Ingredient correction** | Tap an ingredient to see why it was matched, then pick another dictionary ingredient or *any* Fineli food. You can also set a manual weight and a scaling rule. "Remember" applies the choice to every recipe using the same wording |
| **Tuo reseptejä** (import) | Paste several URLs at once; each gets a diagnostics card (detected fields, matched/approximated ingredients, ambiguous ones). Warns when the recipe was already imported. Fallback: paste the page HTML when a site blocks automated fetching |
| **Suunnittele puolestani** (auto-planning) | Wizard for a **week or a single day**: which days, how many people, which meals, and **"eat yesterday's dinner as today's lunch"** (on by default). Then diet (vegetarian/vegan + gluten-/milk-/lactose-free), an optional **daily calorie maximum per person**, weekday/weekend cooking-time limits, ingredients to use up or avoid, favourites/ratings, no repeats, own recipes only or + Fineli catalogue, fill empty slots or replace. Produces an editable preview (swap any single meal, see kcal per person per day against the maximum) and then saves it; a shopping list is one click away |
| **Omat tuotteet** (own products) | Add products Fineli doesn't have. **Import from K-Ruoka or S-kaupat product pages**: nutrition per 100 g, EAN, brand, image, package size, category and allergen-based diet markers, from the page source (automatic fetch where the store allows it, otherwise paste the source). Copied label text ("Proteiini 19 g") also works, and everything can be entered by hand. Recipes match products by name, brand + name or your own aliases, and products work in nutrition, shopping lists and diet checks |
| **Ruokalista** (meal planner) | Day / week / custom date range. Breakfast, lunch, dinner, snack and other slots. Several recipes per meal, per-meal servings, **note-only meals** ("Syödään ulkona", "Jämät"), drag & drop between days and meals (Alt/Option to copy), duplicate, copy to tomorrow, **copy a day**, **copy the week forward**, move dialog (works on touch devices), remove with **undo**, clear, **print**, and **leftovers** ("Tähteet huomisen lounaaksi"): the source meal is cooked with extra portions and the leftover meal is linked to it, so shopping counts the portions once. Daily kcal per person |
| **Ostoslista** (shopping list) | Generated from any date range, merged by ingredient with safe unit normalization, grouped into store categories. Also takes recipes added directly from a recipe page. Staples you keep at home (pantry list) go to a collapsed **"Löytyy kotoa"** group. Tick items off (persisted), change category (remembered), add manual items, delete with undo, "hide bought", **share** (Web Share API or clipboard, plain text by aisle) and **print**. Shows the source recipe line per item and warns when the meal plan changed since the list was built |
| **Ravintosisältö** (nutrition) | Week total, daily average and per-day figures, per person or whole household. Energy split, optional targets with progress bars, per-meal breakdown and a coverage indicator (e.g. *"94 % of ingredients confidently matched"*) |
| **Asetukset** (settings) | Optional nutrition targets (nothing is prescribed), household serving size, week start, pantry list, theme, remembered ingredient mappings, JSON export/import, reset, Fineli dataset info and reload |
| **PWA / offline** | Installable. After the first load everything works offline (IndexedDB + service worker), except fetching new recipe URLs |

## Quick start

Requirements: **Node.js 22.18+** (the server and scripts are TypeScript run directly by
Node's type stripping; developed on Node 26).

```bash
npm install
npm run dev          # http://localhost:5173 – app + recipe fetch endpoint
```

Production build:

```bash
npm run build        # type-check + bundle into dist/
npm start            # serves dist/ and /api/fetch-recipe on http://127.0.0.1:4173
```

Tests:

```bash
npm test             # vitest, 190 tests
npm run typecheck
```

The Fineli dataset is already generated into `public/data/`. To regenerate it or use a
newer Fineli release, see [Fineli data import](#fineli-data-import).

Environment variables for the server (`npm start`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address (local use only by default) |
| `RECIPE_FETCH_EXTRA_DOMAINS` | – | Comma-separated extra recipe domains to allow |
| `RECIPE_FETCH_ALLOW_ANY_HOST` | – | `1` = allow any public host (SSRF address checks still apply) |

### Static hosting (GitHub Pages, SFTP)

`npm run build` produces a self-contained `dist/` folder (including an Apache `.htaccess`
with SPA fallback and security headers). Without the Node server, fetching recipes by URL
is unavailable; pasting the page HTML works everywhere. Build variables:

| Variable | Default | Purpose |
|---|---|---|
| `BASE_PATH` | `/` | URL path the app is served from, e.g. `/MealPlanner/` |
| `VITE_STATIC_ONLY` | – | `true` = hide URL fetching and offer only HTML paste |

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds and deploys the
app to GitHub Pages on every push to `main` (repository Settings → Pages → Source: GitHub Actions).

## Architecture

```
┌──────────────────────────── Browser (all user data lives here) ─────────────────────────────┐
│  React UI (src/ui)                                                                          │
│     │                                                                                       │
│  Domain (src/domain) – pure TypeScript, no I/O                                              │
│     finnish.ts        inflection candidates, brand/noise stripping                          │
│     ingredientParser  "2 tlk (à 400 g) tomaattimurskaa" → quantity/unit/weights/name        │
│     ingredients.ts    canonical ingredient dictionary (≈310 entries, Fineli-linked)         │
│     matcher.ts        text → canonical ingredient → Fineli food + confidence                │
│     units / scaling / nutrition / shoppingList / recipeInfo                                 │
│     │                                                                                       │
│  Import (src/import) – adapters + extractors (JSON-LD, app state, HTML) run on a DOM        │
│     │                                                                                       │
│  Persistence (src/db) – Dexie/IndexedDB, bootstrap, repo, export/import                     │
└─────┬───────────────────────────────────────────────────────────────────────────────────────┘
      │ GET /api/fetch-recipe?url=…   (only because of CORS)
┌─────▼──────────── Minimal fetch service (server/) ──────────────┐
│ allowlist + SSRF checks → pinned HTTPS GET → returns raw HTML   │
│ no storage, no parsing, no logging of content                   │
└─────────────────────────────────────────────────────────────────┘
```

**Why local-first with IndexedDB:** this is a single-user personal tool. IndexedDB (via
Dexie) handles the ~4 000-food Fineli table, thousands of recipes and all plans
comfortably. It works offline and keeps personal dietary data on the device. The
database layer is isolated in `src/db`, so a Prisma/SQLite/PostgreSQL backend could
later implement the same operations.

**Why a (tiny) backend at all:** browsers cannot fetch other sites' HTML because of
CORS. The server does exactly one thing: fetch an allowlisted recipe page safely and
return its HTML. The same handler is mounted into Vite in development
(`vite.config.ts`) and served by `server/index.ts` in production. Parsing happens in the
browser, and the same parsing code runs in tests with jsdom.

## Technology stack

- **React 19 + TypeScript**, **Vite 8**, **React Router 8** (lazy-loaded routes)
- **Tailwind CSS 4** with semantic colour tokens (light + dark theme)
- **Dexie 4** (IndexedDB) + `dexie-react-hooks` for live queries
- **Zod 4** for schemas: domain types, settings and export-file validation
- **vite-plugin-pwa** (Workbox) for installability and offline caching
- **Vitest** + jsdom + fake-indexeddb for tests
- **fflate** (dev only) to read the official Fineli zip
- Node's built-in `http`/`https`/`dns`/`net.BlockList` for the fetch service – no framework

No authentication, cloud database, Docker, Redis or similar. None is needed for the
current scope.

## Data model

Defined with Zod in [`src/domain/types.ts`](src/domain/types.ts); the IndexedDB schema is in
[`src/db/db.ts`](src/db/db.ts).

| Entity | Storage | Notes |
|---|---|---|
| **Recipe** | `recipes` | `origin`: `seed` \| `user` \| `imported` \| `catalogue`; `inCollection` = in "Omat reseptit"; source fields (`sourceId`, `sourceUrl`, `sourceName`, `author`); `sourceNutrition` exactly as the source reported it, with its stated basis; `importReport` (diagnostics); `notes` (personal notes) |
| **RecipeIngredient** | embedded in Recipe | `raw` (original line, never modified), parsed `quantity`/`quantityMax`/`unit`/`explicitGrams`/`perUnitGrams`/`size`, `name`, `note`, `group`; mapping `canonicalId` → `fineliId` + `confidence` + `matchMethod` + `userOverride`; `gramsOverride`; `scaling` rule |
| **RecipeSource** | `recipeSources` | sites and datasets (K-Ruoka, Yhteishyvä, Valio, Fineli, user) |
| **Ingredient** (canonical) | code: `src/domain/ingredients.ts` | versioned with the app; aliases = **IngredientAlias** |
| **IngredientMapping** | `ingredientMappings` | user corrections keyed by normalized ingredient name |
| **NutritionFood** | `fineliFoods` | Fineli food, nutrients per 100 g, household unit weights, diet flags |
| **NutritionMapping** | on RecipeIngredient | original → canonical → Fineli → confidence (auditable per line) |
| **MealPlan / Meal** | `mealPlans`, `mealItems` | a *meal* = mealItems with the same date + slot; each has its own `servings`; `recipeId: null` + `note` = note-only entry; `extraServings` = portions cooked for later, `leftoverOfId` = eats leftovers of another meal |
| **ShoppingList / ShoppingListItem** | `shoppingLists`, `shoppingItems` | list = plan date range + `extraRecipes` added directly; item amount as {mass g, volume ml, counts per unit}; `checked`, `category` (+override), `manual`, `sources`, `productId` |
| **Favourite** | `favourites` | |
| **Product** | `products` | the user's own products: label nutrition per 100 g, EAN, brand, image, package/piece weight, g per dl, category, aliases, diet markers, source (K-Ruoka / S-kaupat / manual). Each has a virtual nutrition id `foodId` ≥ 900 000 000, so it works exactly like a Fineli food |
| **Unit / UnitConversion** | code: `src/domain/units.ts` | unit registry (forms, kind, factor, Fineli household unit, generic fallback weight) |
| **CategoryOverride** | `categoryOverrides` | remembered shopping categories |
| **Settings** | `settings` | user settings, data versions (Fineli release, seed version) |

The **ingredient vs. food vs. product** distinction is explicit. "2 dl kermaa" is a
recipe ingredient. It maps to the canonical ingredient *Kuohukerma* (which the shopping
list shows) and to the Fineli food *Kerma, kuohukerma, rasvaa 38 %* (which the
nutrition uses). A future supermarket product (`Product`) can point at either without a
redesign.

## Fineli data import

Source: <https://fineli.fi/fineli/fi/avoin-data>. It's the *basic package*
(Ravintoarvopaketti): semicolon-separated CSV files, historically ISO-8859-1 encoded.

Files used: `food.csv` (id, name, type FOOD/DISH, process, classes), `foodname_FI/EN/SV`,
`component_value.csv` (nutrient values per 100 g edible portion, decimal comma),
`foodaddunit.csv` (household unit weights such as DL, RKL, TL, KPL_S/M/L), `specdiet.csv`
(diet flags), `contribfood.csv` (ingredient rows of Fineli dishes), and
`fuclass_FI`/`igclass_FI` (class names).

```bash
npm run fineli:import                                   # uses data/fineli-source/
npm run fineli:import -- --source ~/Downloads/Fineli_Rel20.zip
npm run fineli:import -- --source ./some/extracted/folder
```

The importer (`scripts/import-fineli.ts`) auto-detects UTF-8 or Latin-1 and keeps these
nutrients: energy (kJ, kcal), protein, available carbohydrate, fat, fibre, sugars,
saturated/mono/polyunsaturated/trans fat, alcohol, salt (NaCl mg → g), sodium,
potassium, calcium, iron, vitamins C, D and B12, folate and cholesterol. It writes:

- `public/data/fineli-foods.json` – all foods with nutrients, unit weights, diets
- `public/data/fineli-dishes.json` – dish recipes for the catalogue
- `public/data/fineli-meta.json` – release + timestamp (the app polls this small file)

On first start (or when `fineli-meta.json` changes) the app loads the data into
IndexedDB. There are **no per-ingredient API requests**.

> **Note on the bundled release.** fineli.fi is behind a bot-protection challenge that
> blocks scripted downloads. The bundled data comes from the community mirror
> [`theel0ja/fineli-data`](https://github.com/theel0ja/fineli-data), an unmodified copy of
> the official package (**Release 18.0**, 4 058 foods). For the latest release, download
> the zip manually from fineli.fi and run the importer with `--source`. The format is
> the same. A test checks that every Fineli id referenced by the ingredient dictionary
> exists in whatever dataset is imported.

### Supplementary food data

Fineli (4 058 foods) is the **master data**. Foods it does not have (saffron, Worcestershire
sauce, hoisin sauce, tempeh, edamame, okra, ricotta, duck breast …) come from two larger
open databases, **translated to Finnish** and used **only when Fineli has no suitable or
likely food**:

| Source | Licence | In the original | Bundled after filtering |
|---|---|---|---|
| [Livsmedelsverket, Livsmedelsdatabasen](https://www.livsmedelsverket.se/om-oss/psidata/livsmedelsdatabasen) (Swedish Food Agency) – Nordic foods, closest to Fineli | CC BY 4.0 | 2 387 | 1 603 |
| [USDA SR Legacy (Standard Reference, Release 28)](https://fdc.nal.usda.gov/) | Public domain (CC0) | 8 789 | 3 405 |

Other candidates were considered and not used (yet): USDA FoodData Central *Foundation*
(small) and *Branded* (US packaged products), the Canadian Nutrient File (largely derived
from USDA – mostly duplicates), French CIQUAL (Licence Ouverte) and UK CoFID (Open
Government Licence) – open, but mostly overlapping and not downloadable from this build
environment, as were Danish Frida and Norwegian Matvaretabellen (good future additions:
add a source in `supplementary.ts` and the importer), and Open Food Facts (ODbL,
crowd-sourced product data – not a reference database).

`npm run supplementary:build` (`scripts/import-supplementary.ts`) reads the bundled raw
files in [`data/supplementary-source/`](data/supplementary-source/README.md), keeps
ingredient-type foods (no ready meals, brand products, baby foods, fast food, restaurant
foods, cooked variants of raw ingredients), maps the nutrients to Fineli's units,
attaches the **Finnish names** from `data/supplementary-source/fi/` and **removes
duplicates**: a food is dropped if Fineli already has the same name, and between the two
sources the first one (Livsmedelsverket) wins. The result is
`public/data/supplementary-foods.json` (+ `supplementary-meta.json`), loaded into its own
IndexedDB table on first start or when re-imported; recipes are then re-matched.

Supplementary foods have ids 800 000 000+ (`src/domain/supplementary.ts`), keep their
English/Swedish name and source id, and are always labelled with the source (USDA /
Livsmedelsverket) in the mapping dialog, nutrition table and grams notes.
Fineli-only facts are not invented for them: gluten/lactose flags are never set, and
Livsmedelsverket foods have no household weights (USDA cup/tbsp/tsp/piece weights are
converted to dl/rkl/tl/kpl).

## Recipe catalogue

Researched options:

- **Fineli dishes** – about 1 900 Finnish dishes with structured ingredient amounts,
  licensed **CC BY 4.0**. Legally bundleable and Finnish, so **used as the catalogue**
  (≈1 500 after excluding baby foods, drinks and supplements). Limitation: no
  preparation instructions, which the UI states clearly. Ingredients are source-mapped
  to Fineli with confidence 1.0.
- Commercial Finnish recipe sites (K-Ruoka, Valio, Yhteishyvä…): copyrighted content, so
  they're **not scraped in bulk**. They're only imported one recipe at a time on the
  user's request, for personal use.
- **Open recipe collections, translated into Finnish** – KitchenGadget8000, USDA MyPlate
  Kitchen (public domain), UniTools, ForkRecipe and the Wikibooks Cookbook (CC BY-SA 4.0).
  Translated to Finnish with metric units, loaded from `public/data/open-recipes/` by
  `src/db/openRecipes.ts` and parsed with the same matcher as imports. Every recipe shows
  its source, author, licence, changes and image credit. Pipeline and licences:
  [`data/open-recipes/README.md`](data/open-recipes/README.md).
- Large English datasets such as RecipeNLG have non-commercial or unclear licensing, so they
  aren't used. Open Food Facts is a *product* database, not recipes (a candidate for
  future product matching).

Also included: **15 original seed recipes** written for this project
(`src/db/seed.ts`), which go through the same parser and matcher as imports.

**Adding a catalogue dataset:** write a function that maps the dataset into `Recipe`
objects (`origin: 'catalogue'`, stable ids like `mydataset-123`, a `sourceId`). Load it
in `loadFineliData`-style code in `src/db/bootstrap.ts` and add its `RecipeSource`.
Catalogue recipes are read-only; editing makes a personal copy.

## Recipe importing

Pipeline (`src/import/pipeline.ts`):

1. Validate the URL and **identify the site**.
2. Run the **site adapter** (site-specific knowledge only).
3. Fill missing fields from **Schema.org JSON-LD** (`application/ld+json`, handles `@graph`, arrays, `HowToSection`/`HowToStep`).
4. … from **embedded app state** (`__NEXT_DATA__`, Next.js flight chunks, `window.__NUXT__`/`__INITIAL_STATE__`).
5. … from **semantic HTML** (microdata, "Ainekset"/"Valmistus" headings with following lists).
6. … from **meta tags** (og:title, og:image, canonical).
7. **Normalize**: parse each ingredient line and map it, parse yield ("4, 4 annosta"), ISO durations and Finnish time text.
8. **Report** found/missing fields, the methods used and any warnings.

Nothing is invented. Missing servings default to the household size *with a visible
warning*. Pages without ingredients or instructions are rejected. The import card
shows what was detected, how many ingredients matched, and which are ambiguous.

Fetching goes through the fetch service. When a site blocks automated requests, the UI
offers **"Liitä sivun HTML"**: open the recipe in your browser, view source, paste it.
The same pipeline then runs entirely in the browser.

## Supported recipe sites

What was actually observed on the live sites during development (September 2026):

| Site | Mechanism | Status |
|---|---|---|
| **Valio** (`valio.fi`) | Complete Schema.org Recipe JSON-LD (ingredients, steps, yield, ISO times, image, author). Ingredient sub-headings exist only in the HTML list (`.vl-recipe-content__ingredients__list` h3 + `li.ingredient-item`), so the adapter merges them in by position. The page also embeds a Cloudflare Turnstile widget for forms (not a block). | ✅ Fetch + parse verified live |
| **Yhteishyvä / S-kaupat** (`yhteishyva.fi`, `s-kaupat.fi`) | Schema.org JSON-LD **plus** Next.js flight data containing a structured recipe. **Each ingredient carries a Fineli id** (`ingredientOptions[].fineliId`), which the adapter uses as a source mapping. Nutrition totals are also given. The JSON-LD `nutrition` mixes per-portion kcal with whole-recipe macros, so the embedded totals are used instead. | ✅ Fetch + parse verified live |
| **K-Ruoka** (`k-ruoka.fi`) | The site answers automated requests with a Cloudflare "Just a moment…" challenge, so its HTML structure couldn't be inspected. The adapter tries JSON-LD, then embedded app state (e.g. `__NEXT_DATA__`), then heading-based HTML, plus K-Ruoka's visible "6 annosta" / "15–30 min" text. The live site format is **unverified**, and the test fixture is synthetic. Use the paste-HTML fallback. | ⚠️ Auto-fetch blocked; paste HTML |
| **Arla** (`arla.fi`) | Schema.org JSON-LD (the `type` attribute is HTML-entity-encoded, which the DOM decodes). Ingredient lines use Arla product names; "Apetina" etc. are recognized as product names. | ✅ Fetch + parse verified live |
| **Kotikokki.net** | Schema.org JSON-LD. Lines often lack a space between number and unit ("1l vettä", "100g …"), which the parser handles. | ✅ Fetch + parse verified live |
| Any other site | Generic chain (JSON-LD → app state → microdata/headings). Fetching needs the domain allowlisted (`RECIPE_FETCH_EXTRA_DOMAINS`); pasting HTML always works. | ✅ Best effort |

## Adding another recipe source

1. Add an adapter object in [`src/import/adapters/index.ts`](src/import/adapters/index.ts):
   ```ts
   export const MySiteAdapter: RecipeSourceAdapter = {
     id: 'mysite', name: 'My Site', homepage: 'https://mysite.fi/reseptit', domains: ['mysite.fi'],
     extract(doc, url) {
       const data = extractJsonLd(doc, url) ?? {}
       // site-specific fixes only – the generic chain fills the rest afterwards
       return { data, methods: data.title ? ['json-ld'] : [], warnings: [] }
     },
   }
   ```
2. Add it to `ADAPTERS`.
3. Add the domain to `ALLOWED_DOMAINS` in [`server/allowlist.ts`](server/allowlist.ts).
4. Save a (trimmed) page as a fixture in `tests/fixtures/` and add a test in `tests/import.test.ts`.

## Own products and store-page import

`src/domain/products.ts` turns a product into a nutrition food (label values per 100 g; sodium derived from salt; household units from package, piece and dl weights). Matching order for a recipe line: **the user's manual mapping → own product** (name, brand + name, or alias; base-form aware, word-boundary safe) **→ dictionary → Fineli search**. Saving a product re-matches the user's recipes (manual choices are kept); deleting one releases the lines that used it.

`src/import/products.ts` reads store pages. Formats were observed in October 2026:

| Source | Where the data is |
|---|---|
| K-Ruoka | `<div id="applicationState" data-state="…">` → `reduxState.productDetails.products.entities[slug].product.productAttributes` (`nutritionalContents[0].nutrients.energyKcal / protein.amount / …`, `measurements.contentSize`, `localizedAllergens.freeFrom`) + JSON-LD `Product` (name, gtin13, brand, image) |
| S-kaupat | `<script id="__NEXT_DATA__">` → `props.pageProps.apolloState["Product:{…}"]` (`productDetails.nutrients[0].nutrients[{name, value}]`, `productImages.mainImage.urlTemplate`, `hierarchyPath`, `brandName`, `ean`) |
| Other shops | Schema.org `Product` JSON-LD (incl. `NutritionInformation`) |
| Text | Copied nutrition table / label lines (`Energia 944 kJ / 227 kcal`, `- josta sokereita 0 g` …) |

Both stores block automated requests (Cloudflare / Vercel checkpoint), so the reliable path is **Cmd/Ctrl + U → copy all → paste**. This was verified with the real, live source of both example product pages (1.8 MB K-Ruoka page, 190 kB S-kaupat page).

## Automatic meal planning

`src/domain/weekPlanner.ts` is a pure, seeded algorithm:

- **Candidates** are classified as breakfast / snack / main (tags, category, title), with per-serving kcal, diet, special diets, time and main protein.
- **Filters:** meal type, diet, special diets, avoid-words, own 1–2 star ratings, side dishes (< 180 kcal) as mains, time limits (weekday/weekend) and the calorie budget. The remaining daily budget is shared across the day's remaining meals by slot share (breakfast 22 %, lunch 30 %, dinner 35 %, snack 13 %). A dinner that will also be tomorrow's lunch must fit a lunch share too.
- **Score:** randomness + own collection + favourites + ratings + use-up ingredients − catalogue dishes without instructions − same main protein as the previous meal/day − repeats.
- **Relaxing:** if nothing fits, constraints relax in order (repeats → time → calories), and the preview says which.
- **Leftovers:** the next day's lunch = yesterday's dinner (`extraServings = people`), saved with `leftoverOfId`.

## Ingredient normalization and nutrition matching

Every recipe line is stored as an auditable chain:

```
"200 g broilerin fileesuikaleita"          ← original wording (raw)
  → quantity 200, unit g, name "broilerin fileesuikaleita"
  → canonical: Broilerin fileesuikale      ← shopping list / diet / category
  → Fineli 11565 "Broileri, rintafilee, nahaton, suikale, leike"   ← nutrition
  → confidence 1.0, method "exact", explanation (Finnish)
```

**Finnish text handling** (`src/domain/finnish.ts`):
- strips brands (Valio, Pirkka, Rainbow, Mutti, Fazer …), trademarks, "esim. …" examples, bracketed text, and preparation notes ("hienonnettuna", "öljyssä", text after a comma)
- generates **base-form candidates** for inflected words ("kevytmaitoa" → kevytmaito, "tomaatteja" → tomaatti, "valkosipulinkynttä" → valkosipulinkynsi, "naudan" → nauta, "voita" → voi …)

**Matching** (`src/domain/matcher.ts`), first hit wins:

| Step | Example | Match confidence |
|---|---|---|
| user mapping for the normalized name | (remembered correction) | 1.0 |
| whole name equals an alias | "kevytmaitoa" → Kevytmaito | 1.0 |
| alias after dropping neutral modifiers | "tuoretta basilikaa" → Basilika | 0.95 |
| alias after dropping meaningful modifiers | "punaleima-emmentaljuustoraaste" → Emmental | 0.85 |
| Finnish **compound head** | "luumutomaattikuutiot" → Tomaatti; "kesäkurpitsaraaste" → Kesäkurpitsa (form word → prefix is the ingredient) | 0.8 |
| direct Fineli name search | unknown foods | ≤ 0.55 |
| supplementary search – only if Fineli found nothing, or only a weak hit (the word somewhere inside a longer name) | "sahramia" → Sahrami (USDA) | ≤ 0.6 |
| nothing | | 0 |

A dictionary entry that Fineli can only approximate (e.g. cumin, turmeric, nutmeg, bay leaf –
estimated as paprika powder in Fineli) can name the real food in a supplementary database
(`supplementary: 'usda:2014'`); it is used when the supplementary data is loaded.

The final confidence is **multiplied by the dictionary entry's `fineliConfidence`**,
which says how well the chosen Fineli food represents the ingredient. For example,
parmesan is estimated with gruyère-type cheese (0.75), and taco seasoning with paprika
powder (0.6), with an explanation shown in the UI.

**Guards against bad substitutions:**
- The Finnish head noun is at the end, so "oliiviöljy" matches *öljy*-type entries and never olives.
- `notWithPrefixes` blocks compounds that change the product: *kookos*maito, *kaura*maito and *soija*maito aren't milk; *maapähkinä*voi isn't butter; *tuore*juusto isn't hard cheese.
- Specific entries come before generic ones: täysjyväpasta → wholegrain pasta, tuorejuusto → cream cheese, ruokakerma → cooking cream.

Low-confidence mappings (< 0.7) are flagged with a "tarkista" badge and listed in the
import report. Correcting one can be remembered for all recipes.

Sources that provide their own Fineli ids (Yhteishyvä) keep that food, with confidence
0.9 and method `source`, while our canonical ingredient is still used for shopping.

## Units, scaling and nutrition calculation

**Units** (`src/domain/units.ts`) are data-driven: mass (mg, g, kg), volume (ml, cl,
dl, l, rkl = 15 ml, tl = 5 ml, mm = 1 ml, kuppi), and count (kpl, pkt, prk, tlk, ps, rs,
pll, nippu, ruukku, kerä, viipale, kynsi, pala, varsi, oksa, annos, levy, hyppysellinen),
including inflected forms (tölkkiä, pussia …).

**Grams per line** (`resolveGrams`), each step with its own confidence:

1. manual weight → 1.0
2. explicit mass in the line "2 dl (100 g)" → 1.0
3. mass unit → 1.0
4. spoon units via **Fineli household weights** (1 rkl oliiviöljy = 13.5 g) → 0.95
5. volume via Fineli DL weight (1 dl vehnäjauhoja = 65 g) → 0.95; dictionary density → 0.85; water density → 0.6 (flagged)
6. package size in the line "(à 400 g)" → 1.0
7. dictionary package/piece weights (1 tlk tomaattimurskaa = 400 g, kananmuna = 55 g) → 0.85
8. Fineli piece weights (KPL_S/M/L, so "1 iso sipuli" = 200 g) → 0.85
9. generic unit guesses (1 pkt ≈ 400 g) → 0.5 (flagged)

**Nutrition** = Σ (Fineli value per 100 g × grams / 100), aggregated to recipe → meal
→ day → week, with daily averages. Values are always labelled as estimates, together
with a coverage figure. By default, plan nutrition is **per person**: one serving of
each planned meal. There's a household toggle.

**Scaling**: planned servings ÷ recipe servings. The rule is per ingredient: `linear`
(default), `sublinear` (factor^0.8; the default for salt, spices, baking powder, yeast
and oils) or `fixed`. Count units round to kitchen-friendly steps (¼/½), and measures
move to better units (6 tl → 2 rkl, 12 dl → 1,2 l).

## Shopping list

- Lines are grouped by canonical ingredient, else by Fineli food, else by normalized name, so "kanasuikale" and "broilerin fileesuikale" merge.
- Same-dimension amounts are always summed exactly: 500 g + 0,5 kg = 1 kg; 2 dl + 5 dl = 7 dl.
- Cross-dimension amounts (g ↔ dl ↔ kpl) are combined **only when a reliable conversion exists** (Fineli household units or dictionary weights with confidence ≥ 0.75). Otherwise they're shown side by side: "200 g + 1 pkt".
- Each ingredient has a preferred shopping dimension (onions in kpl, milk in dl/l, potatoes in kg).
- Water is excluded; unquantified items show "tarpeen mukaan".
- Regenerating keeps checked state, category overrides and manual items.

## Import / export format

Settings → *Vie tiedot (JSON)*. Versioned and validated with Zod
(`src/db/exportImport.ts`):

```json
{
  "format": "meal-planner",
  "version": 1,
  "exportedAt": "2026-09-30T12:00:00.000Z",
  "app": "Ateriasuunnittelija",
  "data": {
    "recipes": [], "collectedCatalogueIds": [], "catalogueNotes": [], "favourites": [],
    "mealPlans": [], "mealItems": [], "shoppingLists": [], "shoppingItems": [],
    "ingredientMappings": [], "categoryOverrides": [], "settings": {}
  }
}
```

Import can **merge** or **replace**. Files from a newer app version are rejected with a
message. Older versions go through `migrate()` (a hook for future schema changes).
Catalogue recipes are rebuilt from the dataset, so only the ids of collected ones are
exported.

## Privacy and security

- All personal data (recipes, plans, shopping lists, settings, corrections) stays in the browser's IndexedDB. There is no analytics and no cloud service.
- The fetch service receives only the recipe URL. It fetches the page like a normal browser request, returns HTML and stores nothing.
- **SSRF protections** (`server/ssrf.ts`, `server/fetchPage.ts`):
  - Only `http(s)`. No credentials in URLs. Default ports only.
  - **Domain allowlist** of recipe sites, so it isn't an open proxy.
  - Rejects `localhost`, `*.local`, `*.internal`, single-label hosts and IP literals.
  - DNS resolution: **every** resolved address must be public. Blocked: loopback, private, CGNAT, link-local (cloud metadata), multicast, reserved, and IPv6 ULA/link-local; IPv4-mapped and NAT64 forms are rejected.
  - The connection is **pinned to the validated IP** (prevents DNS rebinding).
  - Manual redirects (max 3), each fully re-validated.
  - 10 s overall timeout. 4 MB response limit enforced after decompression. HTML content types only.
  - Rate limit (30 requests/min per client). The server binds to 127.0.0.1 by default.
- The static server (`server/static.ts`) never crashes on malformed requests, rejects path traversal, dotfiles and unexpected methods, and sends a strict **Content-Security-Policy**: `script-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`; images from any https origin because recipe images are hot-linked. It also sends `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `Cross-Origin-Opener-Policy` and `Permissions-Policy`. Only the service worker scripts get `connect-src https:`, so that the offline image cache works.
- Every rendered URL goes through `safeHttpUrl()`. The data schema drops non-http(s) URLs, so a crafted export file can't inject `javascript:` links. JSON import is limited to 25 MB.

## Testing

`npm test` runs 209 Vitest tests:

| File | Covers |
|---|---|
| `tests/parser.test.ts` | ingredient line parsing ("2 dl kevytmaitoa", "500 g broilerin fileesuikaleita", "1 sipuli", "2 rkl oliiviöljyä", "1 pkt tomaattimurskaa", "3 kananmunaa", package weights, ranges, sizes, trailing quantities), servings, durations, Finnish normalization |
| `tests/units-scaling.test.ts` | unit registry, exact conversions, refused conversions, Finnish formatting, recipe scaling and scaling exceptions |
| `tests/matching.test.ts` | dictionary integrity against the Fineli data, canonical normalization of spelling variants, brand products → generic foods, olive oil ≠ olives, cream cheese ≠ milk, wholegrain pasta, compound heads, confidence scale, user overrides |
| `tests/nutrition-shopping.test.ts` | gram resolution for every unit kind, nutrition math against Fineli values, servings scaling, no invented values, shopping aggregation (spec example, 500 g + 0,5 kg = 1 kg, dl+l+rkl, pieces+grams, refusing unsafe conversions, categories) |
| `tests/import.test.ts` | Valio and Yhteishyvä fixtures from the real pages, synthetic K-Ruoka app-state fixture, microdata and heading fallbacks, missing-field reporting, bot-page detection |
| `tests/data.test.ts` | seed recipes, Fineli catalogue, remembered mappings across recipes, shopping list regeneration keeping state, export/import round-trip in IndexedDB (fake-indexeddb), invalid/future files |
| `tests/ssrf.test.ts` | address classification, URL policy, allowlist, DNS-rebinding rejection |
| `tests/server.test.ts` | static server hardening: malformed URLs (crash regression), traversal, dotfiles, security headers, worker CSP |
| `tests/products-planner.test.ts` | K-Ruoka / S-kaupat / text product parsing, products as nutrition foods, product matching and rematching, shopping and export of products (id remapping), ratings, leftover logic (shopping counted once, servings sync, undo), meal planner (leftover lunches, determinism, diet/time/avoid filters, calorie maximum, single day, occupied slots, reroll, saving) |
| `tests/supplementary.test.ts` | supplementary dataset (id range, no duplicates within it or with Fineli, plausible nutrients, dictionary references), Fineli-first priority, fallback matches, source labels, loading into IndexedDB and offline behaviour |
| `tests/features.test.ts` | URL sanitizing, note meals, copy day/week, undo, direct recipe → shopping list, pantry matching, shareable text, notes, duplicate detection, special diets, synonym search without false positives, product-name matching, Arla and Kotikokki fixtures |

## Data licensing considerations

- **Fineli** © Terveyden ja hyvinvoinnin laitos (THL), **CC BY 4.0**. Attribution is shown in the app (sidebar, recipe catalogue, settings). THL isn't responsible for interpretations of the data.
- **Fineli catalogue dishes** are derived from Fineli's recipe rows (CC BY 4.0).
- **Imported recipes** (K-Ruoka, Yhteishyvä, Valio, others) are copyrighted by their publishers. The app treats them as the user's personal copies: it stores them locally with source name, author and original URL, shows attribution on the recipe page, and never republishes or bundles them. Images are hot-linked from the source rather than copied.
- **Test fixtures** in `tests/fixtures/` are trimmed copies of two public recipe pages. The structure is kept for parser tests, and instruction prose was replaced by placeholders to avoid redistributing the text.
- **Seed recipes** are original texts written for this project.
- **Open recipe catalogue**: per-source licences and credits in [`data/open-recipes/README.md`](data/open-recipes/README.md). Translations of CC BY-SA recipes are CC BY-SA 4.0. Attribution comes from the source data by recipe id, never from the translation, and is shown on every recipe page and under Settings → Reseptiaineistot. Images are hot-linked with their credit shown below the picture.
- **Supplementary food data**: Livsmedelsverket Livsmedelsdatabasen, **CC BY 4.0** (attribution in Settings, sidebar and next to every value used); USDA SR Legacy, **public domain**. Names are machine-assisted translations and the data is filtered – stated in the app; the sources are not responsible for the changes. See [`data/supplementary-source/README.md`](data/supplementary-source/README.md).
- The bundled Fineli CSV source files in `data/fineli-source/` are an unmodified CC BY 4.0 copy of the official package.

## Known limitations

- **K-Ruoka** can't be fetched automatically (bot protection), and its page structure is unverified. Use "Liitä sivun HTML".
- Other sites may also add bot protection at any time; the paste fallback always works.
- The bundled **Fineli release is 18.0** (via a mirror). Import a newer official zip for current data.
- Nutrition is an **estimate**: generic foods stand in for branded products, cooking losses and water uptake aren't modelled (raw ingredient weights are used), and spices without Fineli entries are approximated.
- Finnish morphology is handled heuristically (candidate generation). Rare inflections or unusual compounds may need a dictionary alias or a manual correction.
- Fineli catalogue recipes have no instructions, and their serving counts derive from Fineli's standard portion sizes.
- Data lives in one browser. Use export/import to move it between devices (there's no sync).
- Drag & drop needs a mouse; on touch devices use the "Siirrä…" menu.

## Future extensibility

Designed-for, not implemented:
- **Grocery products**: the `products` table and `ShoppingItem.productId` exist, and products map to canonical ingredients or Fineli foods.
- **Backend / sync / accounts / households**: all persistence goes through `src/db/repo.ts` and the versioned export format.
- **Allergies / diets**: canonical ingredients carry a diet class, and Fineli foods carry special-diet flags (gluten-, milk-, lactose- and egg-free).
- **Price estimation**: via products.
- **AI-assisted normalization and substitutions**: can plug in as another matcher step before `fineli-search`, keeping the same confidence/explanation contract.
- **Automatic meal planning**: can use the nutrition and filter functions in `src/domain`.
