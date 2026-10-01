# Product & quality review (2026-10-01)

Verification: 174 automated tests (`npm test`), full type-check, production build, and a headless-Chrome walkthrough against the **production server** (strict CSP active) on desktop and mobile widths.

Review of the Meal Planner from three perspectives – **product owner**, **customer
representative** and **quality/security** – followed by a decision for each finding.
Status legend: ✅ implemented in this round · ⏭ deferred (with reason) · ℹ️ no change needed.

## 1. Product owner – feature gaps

| # | Finding | Why it matters | Decision |
|---|---|---|---|
| P1 | A recipe can only reach the shopping list via the meal plan | "I just want to buy the ingredients for this one recipe" is a core use case | ✅ **"Lisää ostoslistalle"** on the recipe page: adds the recipe (with servings) to a new or existing list; stored on the list so regeneration keeps it |
| P2 | Staples the household already has (salt, oil, pepper) clutter every shopping list | The pantry list already exists in settings but only affects search | ✅ Items matching the pantry go to a collapsed **"Löytyy kotoa"** group, left out of the progress count |
| P3 | Shopping list can't be shared or printed | Families split shopping; many people shop with a paper list | ✅ **Jaa / kopioi** (Web Share API, clipboard fallback, plain text grouped by aisle) and **Tulosta** with print styles |
| P4 | Recipes and the weekly menu can't be printed | Common expectation for recipe services | ✅ Print buttons + print stylesheet (navigation hidden, clean layout) for recipes and the planner |
| P5 | No "cooking mode" | Phone screens turn off while cooking | ✅ **Kokkaustila**: Screen Wake Lock (where supported), larger text, tick-off steps |
| P6 | No way to repeat a good week | Most households rotate menus | ✅ **Kopioi viikko seuraavalle viikolle** and **Kopioi päivä…** in the planner |
| P7 | Meals that aren't recipes can't be planned ("syödään ulkona", "jämät", "koulu") | Otherwise the plan has misleading gaps | ✅ **Muistiinpanoateria** (note-only meal item) – shown in the plan, ignored by shopping and nutrition |
| P8 | Importing the same URL twice silently creates duplicates | Data quality | ✅ Duplicate detection by source URL – the import card offers "Avaa olemassa oleva" instead |
| P9 | Only three import sites are allowlisted | Customers will paste links from other big Finnish sites | ✅ Verified live and allowlisted **arla.fi** and **kotikokki.net** (both expose Schema.org Recipe JSON-LD) |
| P12 | Fineli lacks many branded products | Users buy specific products | ✅ **Omat tuotteet**: add products by hand or import from K-Ruoka / S-kaupat product pages (verified against the live pages) |
| P13 | Planning a week takes effort | Core value of a meal planner | ✅ **Suunnittele puolestani** for a week or a day, with people count, leftovers-as-lunch (on by default) and a daily calorie maximum |
| P10 | Price estimates, store integration, sync, accounts, automatic meal planning | Listed as *future* features in the specification | ⏭ Out of scope by specification; the data model already has hooks (`products`, versioned export) |
| P11 | Recipe ratings | Needed for the planner to prefer good recipes | ✅ 1–5 stars (sorting, filter, planner); cooking history still deferred |

## 2. Customer representative – usability gaps

| # | Finding | Decision |
|---|---|---|
| C1 | Allergies and special diets: no gluten-free / milk-free / lactose-free filters, although Fineli has these flags | ✅ Filters **Gluteeniton, Maidoton, Laktoositon** + badges on the recipe page (derived from Fineli special-diet flags of every mapped ingredient; recipes with unknown ingredients are not claimed to be free of anything) |
| C2 | Searching "kana" doesn't find recipes written with "broilerin fileesuikale" | ✅ Search also covers the canonical ingredient's synonyms |
| C3 | No place for own notes ("vähemmän chiliä", "lapset tykkäsi") | ✅ **Omat muistiinpanot** field on every recipe (also on catalogue recipes), included in export |
| C4 | Accidental deletes (meal, shopping item) can't be undone | ✅ **Kumoa** action in the toast |
| C5 | The browser back button on a recipe opened from a shared link leaves the app | ✅ Falls back to the recipe list when there is no in-app history |
| C6 | Selecting a deleted shopping list from an old link shows "no lists" even though other lists exist | ✅ Falls back to the newest list (bug B3) |
| C7 | Nutrition: per-person view against own targets | ℹ️ Already present (per person default + household toggle, optional targets) |
| C8 | Finnish language consistency | ℹ️ Reviewed all pages; no English left in the UI (source-provided text such as "4 portion" is not displayed) |

## 3. Quality & security findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| S1 | **High** (DoS) | `server/index.ts`: a malformed percent-encoding in the path (`/%E0%A4%A`) threw `URIError` inside the request handler and **crashed the production server** | ✅ Decode inside try/catch → 400; handler errors can never escape; regression test |
| S2 | Medium | Recipe `sourceUrl` / `imageUrl` from an imported JSON file or the edit form were rendered without validation (`href`, `src`); an invalid `sourceUrl` also **crashed the recipe page** (`new URL()` throws) | ✅ `safeHttpUrl()` used for every rendered URL; the export schema drops non-http(s) URLs; the edit form validates |
| S3 | Medium | Production static server sent no Content-Security-Policy / frame protection | ✅ Strict CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`…), `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |
| S4 | Low | JSON import read files of any size into memory | ✅ 25 MB limit with a clear message |
| S5 | Low | Static server served dotfiles if present in `dist/` | ✅ Dotfiles are refused |
| B1 | Bug | Recipe page crash on invalid `sourceUrl` (see S2) | ✅ |
| B2 | Bug | Back navigation leaving the app (C5) | ✅ |
| B3 | Bug | Stale `?lista=` id hid all shopping lists (C6) | ✅ |
| S6 | **High** (found in QA) | With the new CSP, **recipe images failed to load in production**: the service worker's runtime image cache fetches cross-origin images, and fetches inside a worker are governed by the worker script's own CSP (`connect-src 'self'`) | ✅ Worker scripts (`sw.js`, `workbox-*.js`) get a separate policy with `connect-src 'self' https:`; the page keeps `connect-src 'self'`. Verified in headless Chrome: images load, also from the offline cache after reload; regression test |
| B4 | Bug (found in QA) | Recipe search had false positives: "kana" matched "porkkana" (substring) and "kaneli" (over-short stem "kan") | ✅ Base forms must stay close to the typed word; substring matches only for long words; regression test |
| B5 | Bug (found in QA) | Brand names that *are* the product were stripped as noise: "Apetina® Snack tomaatti-basilika" (feta-type cheese) matched **basil** | ✅ Dictionary `productNames` (Apetina, Philadelphia, Aura, Koskenlaskija, Oltermanni, Keiju, Flora, Becel, Härkis …) recognized from the raw line; exact name matches still win |
| B6 | Minor (found in QA) | Units "kourallinen" (handful) and alias "terttutomaatti" were missing (seen on arla.fi) | ✅ Added |
| U1 | UX (found in QA) | On mobile the note-meal options were below a long recipe list in the picker | ✅ Moved above the list |
| ℹ️ | – | SSRF protection, redirect re-validation, response limits, DOMParser (no script execution), React escaping, `npm audit` (0 vulnerabilities) | Re-verified, no change needed |
