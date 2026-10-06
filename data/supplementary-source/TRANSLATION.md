# Supplementary food names – translation spec

Input: `data/supplementary-source/input/<source>.json` (made by `npm run supplementary:list`), an
array of `{ "id", "name", "group" }`. `livsmedelsverket` names are Swedish, `usda` names are English.

Output: `data/supplementary-source/fi/<source>/<NNN>.json`, one file per batch of **250 foods in
input order** (batch 000 = foods 0–249, 001 = 250–499, …). Each file is a JSON array with one
object per input food, in the same order:

```json
[
  { "id": "usda:6971", "fi": "Worcestershirekastike" },
  { "id": "usda:2014", "fi": "Juustokumina, siemen, kuivattu" },
  { "id": "livsmedelsverket:1", "fi": "Naudantali" },
  { "id": "usda:14550", "skip": "ei ruoanlaittoaines (lisäravinnejuoma)" }
]
```

Copy `id` exactly. Never translate or copy nutrient values; the build script takes them from the
source by id.

## Why the names matter

The app uses these foods **only when Fineli has no suitable food**. Recipe ingredient lines such as
`2 rkl worcestershirekastiketta` are matched to food names by their Finnish base form, so a name must
start with the word a Finnish recipe would use. Identical Finnish names are treated as duplicates
(Fineli wins, then Livsmedelsverket, then USDA), so use consistent wording for the same food.

## Name style (like Fineli)

`Pääsana, tarkenne, tarkenne` – comma-separated parts, first part capitalised, the rest lower case.

1. **First part = the everyday Finnish name of the food, singular nominative, one word where Finnish
   writes one word.** This is the word a recipe uses: `Worcestershirekastike`, `Sahrami`, `Mirin`,
   `Kapris`, `Tähtianis`, `Laardi`, `Kookosmaito`, `Ricotta`, `Tomatillo`, `Okra`, `Maniokki`,
   `Sitruunaruoho`, `Hoisinkastike`, `Melassi`, `Tamarindi`, `Ghee`, `Kefiiri`, `Pancetta`,
   `Filotaikina`, `Naudanpaisti`, `Porsaankylki`, `Kalkkunanrinta`, `Lohi`, `Tilapia`.
   Use established Finnish names (ruokaohjeiden kieli), loanwords where Finns use them
   (`Ricotta`, `Chorizo`, `Pak choi`, `Tofu`). Don't put a generic category first when the specific
   food has its own name: `Ricotta, täysmaitoinen`, not `Juusto, ricotta`.
2. **Then the details that change nutrition**, most important first: kind/variety, part/cut,
   fat %, state and processing, salt/sugar.
   - raw = `raaka`, cooked = `kypsennetty`/`keitetty`, dried = `kuivattu`, frozen = `pakaste`,
     canned = `säilyke`, with liquid = `liemineen`, drained = `valutettu`, powder = `jauhe`,
     fresh = `tuore`, smoked = `savustettu`, salted = `suolattu`, unsalted = `suolaton`,
     sweetened = `makeutettu`, unsweetened = `makeuttamaton`, light/reduced fat = `kevyt`/`vähärasvainen`,
     whole milk = `täysmaito`, skim = `rasvaton`, commercially prepared = `teollinen`,
     prepared from recipe = `kotitekoinen`, dry mix = `kuivaseos`.
   - Meat: Finnish cut names (`ulkofilee`, `sisäfilee`, `paisti`, `etuselkä`, `lapa`, `rinta`, `kylki`,
     `potka`, `jauheliha`), e.g. `Naudanpaisti, sisäpaisti, raaka`, `Broilerin koipi, nahallinen, raaka`.
   - Fat: `rasvaa 10 %` (Finnish number style: decimal comma, space before %).
3. **Leave out** US/Swedish-only noise: "enriched", "year round average", "includes USDA commodity",
   "variety of brands", "NFS", "industrial", "household", "composite", package or inch sizes,
   imperial units, vitamin fortification details unless that is the point of the product.
   Keep a brand only when the food *is* the brand (rare).
4. Swedish abbreviations: `konserv.` = säilyke, `m.` = med, `u.` = utan, `fett` = rasvaa,
   `berikad` = vitaminoitu (usually leave out), `lätt` = kevyt.
5. Plain text only, no quotes or brackets, max ~80 characters.

## When to skip (`"skip": "<syy suomeksi>"`)

- not something used in home cooking or eaten as such in Finland: infant formula, dietary
  supplements, protein/sports powders, meal replacements, animal feed-like items
- a food that is only meaningful with a US brand/restaurant context
- clearly duplicate of the previous entry with only an irrelevant difference (the build script also
  removes identical names, so this is optional)

Don't skip because a food is exotic – exotic foods are exactly why this supplement exists.
