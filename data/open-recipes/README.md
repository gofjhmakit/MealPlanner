# Open recipe catalogue

Openly licensed recipe collections, translated into Finnish for the app's recipe catalogue.

| Source | Recipes | Licence | Credit |
|---|---:|---|---|
| [KitchenGadget8000](https://github.com/gofjhmakit/KitchenGadget8000) | 460 | Apache-2.0; 49 recipes from [pacharanero/recipes](https://github.com/pacharanero/recipes) are CC BY-SA 4.0 | Hermanni Mäkitalo; Marcus Baw |
| [USDA MyPlate Kitchen](https://myplate.food/recipes) | 1 072 | Public domain (U.S. federal work); images by MyPlate.food, reuse with credit | USDA Center for Nutrition Policy and Promotion; MyPlate.food |
| [UniTools world recipes](https://theunitools.com/en/data) | 501 | CC BY-SA 4.0; photos from Wikimedia Commons under their own licences (credited per recipe) | UniTools — theunitools.com |
| [ForkRecipe](https://github.com/futurechef/forkrecipe-recipes) | 963 | CC BY-SA 4.0 | ForkRecipe and its authors |
| [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents) | 3 798 | CC BY-SA 4.0 | Wikibooks contributors (dump: [gossminn/wikibooks-cookbook](https://huggingface.co/datasets/gossminn/wikibooks-cookbook), 2024-07-31) |

**Licence of the translations.** The Finnish versions in `fi/` and `public/data/open-recipes/`
are adaptations: translated, converted to metric, and ratio recipes scaled to real amounts.
Translations of CC BY-SA recipes are licensed **CC BY-SA 4.0**. Translations of public-domain
MyPlate recipes are dedicated to the public domain (CC0). Translations of the Apache-2.0
KitchenGadget recipes stay under Apache-2.0. Every recipe record carries its own `license`,
`author`, `sourceUrl` and image credit, and the app shows them on the recipe page and under
Settings → Reseptiaineistot.

## Pipeline

```
npm run recipes:fetch -- --kitchengadget ~/Documents/Arduino/KitchenGadget8000/KG8K_v2/spiffs_data/recipes
node scripts/open-recipes/fetch-myplate.ts     # ~18 min, 1 page/s, resumable
npm run recipes:normalize                      # raw/ → en/<source>.json (common English format)
# translate en/ → fi/<source>/NNN.json following TRANSLATION.md
npm run recipes:build                          # fi/ + en/ → public/data/open-recipes/ + not_recognized.md
```

- `raw/` – downloaded sources (git-ignored, re-downloadable)
- `en/` – normalised English recipes with attribution (input for translation and attribution)
- `fi/` – Finnish translations, 25 recipes per file; `{"id", "skip": "reason"}` marks recipes left out
- `not_recognized.md` – ingredient names the Fineli matcher couldn't map, most common first

Left out on purpose: 41 KitchenGadget recipes whose ingredient lists were truncated in the
source files, and Wikibooks pages that aren't recipes (see `skip` reasons in `fi/wikibooks/`).

Not used, because the licence doesn't allow redistribution or is unclear: RecipeNLG / Recipe1M
(research only), Kaggle datasets scraped from commercial sites (licence claims unreliable),
Open Recipes (scraped), TheMealDB (not openly licensed).
