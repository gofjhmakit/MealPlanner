# Open recipe translation – spec

Input: `data/open-recipes/en/<source>.json` (array of English recipes, made by
`scripts/open-recipes/normalize.ts`).
Output: `data/open-recipes/fi/<source>/<NNN>.json`, one file per batch of **25 recipes in input
order** (batch 000 = recipes 0–24, batch 001 = 25–49, …). Write each batch file only when it is
complete. Then the work can resume from the first missing batch.

Order of sources: `kitchengadget`, `myplate`, `unitools`, `forkrecipe`, `wikibooks`.

After every few batches run `npm run recipes:build`. It parses and Fineli-matches your Finnish
ingredient lines with the app's own code, writes `public/data/open-recipes/` and
`data/open-recipes/not_recognized.md`, and prints a per-source match rate. Use the report to fix
wording: an ingredient the matcher doesn't know is often written in an unusual form (see the
style rules below).

## Output format

Each batch file is a JSON array. Copy `id` exactly from the input. **Do not copy source, author,
license, image or URLs.** The build script takes attribution from the English input by `id`, so
credit can never be lost or garbled in translation.

```json
[
  {
    "id": "myplate-2-step-chicken",
    "title": "Kana kermaisessa kastikkeessa",
    "description": "Helppo arkiruoka kahdesta pääraaka-aineesta…",
    "servings": 4,
    "prepTimeMin": 10,
    "cookTimeMin": 30,
    "totalTimeMin": 40,
    "category": "Pääruoat",
    "tags": ["kana", "arkiruoka", "nopea"],
    "ingredients": [
      "1 rkl rypsiöljyä",
      "2 broilerin rintafileetä (n. 400 g)",
      "Kastike:",
      "1 tlk (300 g) kanakeittotiivistettä",
      "1 dl vettä"
    ],
    "instructions": ["Kuumenna öljy pannulla keskilämmöllä.", "…"],
    "notes": ["Vinkki: …"]
  },
  { "id": "wikibooks-some-page", "skip": "ei ruokaresepti (artikkeli tekniikasta)" }
]
```

- `servings`: a number. If the source gives none, estimate sensibly and add `"servingsEstimated": true`.
- Times in minutes. Leave out the ones you can't tell; don't invent them.
- `category`: exactly one of: `Aamiainen`, `Pääruoat`, `Keitot`, `Salaatit`, `Lisukkeet`,
  `Kastikkeet ja dipit`, `Leivät ja leivonnaiset`, `Jälkiruoat`, `Välipalat`, `Juomat`, `Säilykkeet`, `Muut`.
- `tags`: lowercase Finnish, 2–6 of e.g. `kasvis`, `vegaaninen`, `kana`, `liha`, `kala`, `äyriäiset`,
  `nopea` (≤ 30 min total), `arkiruoka`, `juhla`, `uuniruoka`, `keitto`, `pasta`, `riisi`, `peruna`,
  plus the cuisine (`italialainen`, `meksikolainen`, `intialainen`, `suomalainen`, …).
  Only use `kasvis`/`vegaaninen` when the ingredient list really is free of meat and fish
  (`vegaaninen`: no dairy, egg or honey either).
- Ingredient group headings go into the `ingredients` array as their own line ending with a
  colon, e.g. `"Täyte:"`, before the lines they apply to. If the English input has
  `group` fields, emit a heading line whenever the group changes.
- `notes`: optional, short. Leave out chatty filler.

## When to skip (`"skip": "<reason in Finnish>"`)

- not actually a recipe (technique article, glossary page, list of links, joke)
- alcoholic drinks / cocktails where alcohol is the point
- ingredient list or method so incomplete that the dish can't be cooked from it
- unsafe practices (e.g. raw home canning without acid/pressure guidance, raw flour eaten uncooked)
- a near-duplicate of a recipe already translated from the same source

Don't skip just because an ingredient is exotic. Translate it, and the report will flag it.

## Ingredient line style – this is what the app's parser understands

Write ingredient lines the way a Finnish recipe would: `<määrä> <yksikkö> <aines partitiivissa>[, lisätieto]`.

- **Units (use only these):** `g`, `kg`, `ml`, `dl`, `l`, `rkl`, `tl`, `mm` (maustemitta),
  `kpl`, `tlk`, `prk`, `pkt`, `ps`, `rs`, `pll`, `nippu`, `ruukku`, `kerä`, `viipale`, `kynsi`, `pala`,
  `varsi`, `oksa`, `annos`, `kourallinen`, `levy`, `ripaus`. Or a bare count: `2 sipulia`.
- **Convert imperial to metric, rounded to what a Finnish cook would measure:**
  - cups → dl (1 cup = 2,4 dl → write `2½ dl` / `2,5 dl`; ¼ cup = ½ dl; ⅓ cup = 0,8 dl → `¾ dl`)
  - tablespoon/tbsp → rkl, teaspoon/tsp → tl (keep counts; ⅛ tsp → `ripaus` or `1 mm`)
  - ounces → g (1 oz = 28 g; round: 8 oz → 225 g → `225 g`, 15 oz can → `1 tlk (425 g)`)
  - fluid ounces → ml/dl; pounds → g (1 lb = 450 g → `450 g` / `500 g` when packs are 500 g)
  - pints/quarts/gallons → dl/l; inches → cm; °F → °C (350 °F = 175 °C, 400 °F = 200 °C)
  - "1 stick butter" = 115 g; "1 can (10.75 oz) condensed soup" → `1 tlk (300 g) …tiivistettä`
  - **Ratio recipes** (`"ratioAmounts": true`, amounts in "parts" or "%"): pick a batch size
    that serves about 4 (or a sensible batch for sauces/breads) and convert all parts to real
    metric amounts. Then set `servings` and `"servingsEstimated": true`.
- Use decimal comma (`2,5 dl`) or unicode fractions (`½`, `¼`, `¾`, `⅓`). Ranges: `1–2 tl`.
- **Ingredient names:** use the everyday Finnish name in partitive after a quantity
  (`2 dl kermaa`, `400 g naudan jauhelihaa`, `1 tlk tomaattimurskaa`, `3 valkosipulinkynttä`).
  Prefer names found in Finnish stores and recipes:
  all-purpose flour → vehnäjauhoja; heavy cream → kuohukermaa; sour cream → kermaviiliä
  (or smetanaa); half-and-half → ruokakermaa; buttermilk → piimää; cream cheese → tuorejuustoa;
  cheddar → cheddarjuustoa; Parmesan → parmesaania; scallion/green onion → kevätsipulia;
  cilantro → korianteria; bell pepper → paprikaa; zucchini → kesäkurpitsaa;
  eggplant → munakoisoa; chickpeas → kikherneitä; ground beef → naudan jauhelihaa;
  chicken breast → broilerin rintafileetä; vegetable oil → rypsiöljyä; shortening → leivontarasvaa;
  baking soda → ruokasoodaa; baking powder → leivinjauhetta; brown sugar → fariinisokeria;
  powdered sugar → tomusokeria; cornstarch → maissitärkkelystä (Maizena);
  broth/stock → kasvis-/kana-/lihalientä (tai liemikuutio + vettä); kosher salt → suolaa.
- Put preparation notes after a comma: `1 sipuli, hienonnettuna`. Optional items:
  `(valinnainen)` at the end.
- "Salt and pepper to taste" → two lines: `suolaa`, `mustapippuria`.
- US-specific convenience products: translate to the nearest Finnish equivalent
  (condensed cream soup → `kermainen keittotiivisteä` / `ruokakermaa + liemikuutio`), and
  mention it in `notes` if the substitute changes the dish.

## Instructions style

Imperative, clear, natural Finnish (`Kuumenna uuni 200 asteeseen.`). Convert temperatures,
pan sizes and measures inside the text as well. Keep the step count close to the source, and
drop chatter. Keep good tips. "Dutch oven" → `valurautapata` / `paksupohjainen kattila`,
"skillet" → `paistinpannu`, "broil" → `grillivastus`/`grillaa uunissa`.

## not_recognized.md

Generated by the build. It lists ingredient names the matcher couldn't map to Fineli
(confidence < 0.5), with counts and example recipes. Don't hand-edit it. If you notice a
wording fix that would make a common item match (e.g. you wrote `kanaliemi` but the dictionary
knows `kanaliemikuutio`), fix the translations rather than the dictionary, unless the item is
genuinely missing. Missing items are left for the app maintainer.
