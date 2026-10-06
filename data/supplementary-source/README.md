# Supplementary food data – sources

Raw data and Finnish translations for `public/data/supplementary-foods.json`. Fineli stays
the master data; these foods are used only when Fineli has no suitable food (see the main
README, "Supplementary food data").

| Directory | Source | Version | Licence |
|---|---|---|---|
| `livsmedelsverket/livsmedelsdatabasen.json` | Livsmedelsverket (Swedish Food Agency), Livsmedelsdatabasen – unmodified JSON export via the mirror [postmodernistx/livsmedelsdatabasen-som-json](https://github.com/postmodernistx/livsmedelsdatabasen-som-json) (commit `9790dc2`, 2023-12-20) | 2023 | CC BY 4.0 |
| `usda-sr28/ABBREV.txt`, `FOOD_DES.txt` | USDA ARS Nutrient Data Laboratory, National Nutrient Database for Standard Reference, Release 28 (= SR Legacy) – unmodified files from the npm package `fda-nutrient-database@1.0.2` | SR28 (2015, revised 2016) | Public domain |

Attribution: *Livsmedelsverket, Livsmedelsdatabasen (CC BY 4.0)* and *U.S. Department of
Agriculture, Agricultural Research Service, Nutrient Data Laboratory. USDA National
Nutrient Database for Standard Reference, Release 28.* The bundled output is filtered and
its names are translated; the sources are not responsible for these changes.

## Pipeline

1. `npm run supplementary:list` – select ingredient-type foods and write
   `input/<source>.json` (`{ id, name, group }`) for translation.
   - Livsmedelsverket: all groups except ready meals (*Rätter*) and meal replacements.
   - USDA: no baby foods, breakfast cereals (brand products), fast foods, meals, American
     Indian/Alaska Native foods or restaurant foods; no brand names; only the raw/basic
     variant of meat, fish, vegetable and legume foods; one food per variant group
     (grades, trims, salt variants collapsed).
2. Translate `input/<source>.json` in batches of 250 to `fi/<source>/NNN.json` following
   [`TRANSLATION.md`](TRANSLATION.md) (Fineli-style names "Pääsana, tarkenne"; items that
   are not useful ingredients are skipped). The bundled translations were produced with
   AI assistance and spot-checked.
3. `npm run supplementary:build` – map nutrients to Fineli's units (USDA carbohydrate by
   difference → available carbohydrate = minus fibre; kJ from kcal; salt from sodium;
   household measures → dl/rkl/tl/kpl), attach the Finnish names, remove duplicates
   (same normalized name as a Fineli food → dropped; same name in both sources →
   Livsmedelsverket kept) and write `public/data/supplementary-foods.json` and
   `supplementary-meta.json`. A new `importedAt` makes the app reload the data and re-match
   recipes.

To add a source (e.g. Frida, Matvaretabellen, CIQUAL): add it to
`SUPPLEMENTARY_SOURCES` in `src/domain/supplementary.ts` with its own id offset, a reader
in `scripts/import-supplementary.ts`, and translations under `fi/<source>/`.
