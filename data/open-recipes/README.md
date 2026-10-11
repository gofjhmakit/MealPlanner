# Open recipe catalogue

Openly licensed recipe collections, translated into Finnish for the app's recipe catalogue.

| Source | Recipes | Licence | Credit |
|---|---:|---|---|
| [KitchenGadget8000](https://github.com/gofjhmakit/KitchenGadget8000) | 460 | Apache-2.0; 49 recipes from [pacharanero/recipes](https://github.com/pacharanero/recipes) are CC BY-SA 4.0 | Hermanni Mäkitalo; Marcus Baw |
| [USDA MyPlate Kitchen](https://myplate.food/recipes) | 1 072 | Public domain (U.S. federal work); images by MyPlate.food, reuse with credit | USDA Center for Nutrition Policy and Promotion; MyPlate.food |
| [UniTools world recipes](https://theunitools.com/en/data) | 501 | CC BY-SA 4.0; photos from Wikimedia Commons under their own licences (credited per recipe) | UniTools — theunitools.com |
| [ForkRecipe](https://github.com/futurechef/forkrecipe-recipes) | 963 | CC BY-SA 4.0 | ForkRecipe and its authors |
| [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents) | 3 798 | CC BY-SA 4.0 | Wikibooks contributors (dump: [gossminn/wikibooks-cookbook](https://huggingface.co/datasets/gossminn/wikibooks-cookbook), 2024-07-31) |
| [Open Recipe Archive](https://github.com/AdamBouhmad/open-recipe-archive) | 2 British sauces | Public domain (historical 1861 recipes) | Isabella Beeton, *The Book of Household Management* (1861); Open Recipe Archive |
| [Kokki-kirja](https://www.gutenberg.org/ebooks/73445) (1849) | 382 (25 done) | Public domain | J. F. Granlund (ed.), Turku 1849 – the first cookbook in Finnish; Project Gutenberg |
| [The Forme of Cury](https://www.gutenberg.org/ebooks/8102) (c. 1390) | 190 (25 done) | Public domain | Master cooks of Richard II; ed. Samuel Pegge (1780); Project Gutenberg |
| [Open Recipe Project](https://github.com/reZach/open-recipe-project) | 2 pictured main dishes | CC0 (recipe and accompanying photograph) | Open Recipe Project contributors |

**Licence of the translations.** The Finnish versions in `fi/` and `public/data/open-recipes/`
are adaptations: translated, converted to metric, and ratio recipes scaled to real amounts.
Translations of CC BY-SA recipes are licensed **CC BY-SA 4.0**. Translations of public-domain
MyPlate and historical recipes and CC0 recipes are dedicated to the public domain (CC0). Translations of the Apache-2.0
KitchenGadget recipes stay under Apache-2.0. Every recipe record carries its own `license`,
`author`, `sourceUrl` and image credit, and the app shows them on the recipe page and under
Settings → Reseptiaineistot.

The British brown gravy and onion sauce come from a historical public-domain cookbook
via Open Recipe Archive; the latter uses prepared gravy. Open Recipe Project's two
recipe records explicitly mark both their photos and recipe text CC0, and their image
URLs point to the original files (not unlicensed stock photos). New Wikibooks translations
include vegetarian gravy and non-alcoholic lemonades. The separate British "Brown Sauce
(Hartshorne)" recipe is intentionally skipped because its source specifies implausibly
large quantities of salt and pepper.

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

## Historical cookbooks

`node scripts/open-recipes/normalize-gutenberg.ts` splits the Project Gutenberg texts (download
`pg73445.txt` and `pg8102.txt` into `raw/gutenberg/`) into `en/kokkikirja.json` and
`en/formeofcury.json`, one record per recipe with the **original wording** and no ingredient list.
The Finnish file adds a modern interpretation: a modern title, an ingredient list in today's
units (old measures such as naula ≈ 425 g, tooppi ≈ 1,3 l, kannu ≈ 2,6 l, kortteli ≈ 3,3 dl are
converted, unstated amounts estimated for ~4–6 servings, `servingsEstimated: true`) and modern steps.
Substitute what can't be had today and say so in a step ("alkuperäisessä myös verta"); medieval
spice mixes: *powdour douce* = sugar, cinnamon, ginger (nutmeg); *powdour fort* = pepper, ginger, cloves.
The build keeps the original text and year (shown on the recipe page under the modern version),
adds the tags `historiallinen` and the century (`1300-luku`, `1800-luku`; Beeton 1861 gets them too),
and the app's "Vanhat reseptit" chip filters on that tag. Historical recipes are not used in
automatic meal suggestions. The same Gutenberg book also holds *Ancient Cookery* (1381) after the
roll – not parsed yet. Robert May's *The Accomplisht Cook* (1660, ebook #22790) is another candidate.

## Backlog

- **Foodista** ([foodista.com](https://www.foodista.com/)) – recipe text is **CC BY 3.0** (site footer, checked via the
  Wayback Machine in October 2026); tens of thousands of recipes, many with photos. To translate later.
  **Check the photo licence per recipe:** some Foodista photos were pulled in from Flickr or uploaded by
  bloggers under their own terms, so a photo is only used when its own licence is free (credit the
  photographer per recipe, like the Commons photos). The site rate-limits (HTTP 429): fetch slowly and cache.

## Photos from Wikimedia Commons

`node scripts/open-recipes/fetch-photos.ts` writes `photos.json`: for recipes without a source photo, the
Wikibooks Cookbook page's own image, or – when the English title is exactly a Wikidata dish name and the
file name matches – that dish's image, credited as *esimerkkikuva ruokalajista*. Every photo carries its
own author and licence from Commons; files with an unclear or non-free licence are skipped.
`recipes:build` uses these when the source record has no image.
