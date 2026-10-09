/**
 * Canonical ingredient dictionary.
 *
 * Each entry is a normalized ingredient concept with:
 *   - Finnish aliases in base form (inflected forms are handled by finnish.ts)
 *   - shopping category and diet class
 *   - the Fineli food used for nutrition + how well it represents the ingredient (fineliConfidence)
 *   - household weights for count units when Fineli has none
 *
 * Fineli IDs were verified against the Fineli open data release; a unit test
 * (tests/ingredients.test.ts) asserts every referenced ID exists in the imported
 * dataset and that its Fineli name matches the expected food.
 *
 * To add an ingredient: append an entry. To improve matching for a spelling:
 * add an alias. No code changes needed elsewhere.
 */
import type { ScalingRule, ShoppingCategory } from './types'

export type Diet = 'vegan' | 'vegetarian' | 'fish' | 'meat'

export interface CanonicalIngredient {
  id: string
  /** Finnish display / shopping list name. */
  fi: string
  en: string
  aliases: string[]
  category: ShoppingCategory
  diet: Diet
  fineliId: number | null
  /** How well the Fineli food represents this ingredient (1 = same food). */
  fineliConfidence: number
  /** Grams per piece (overrides Fineli KPL_M). */
  pieceGrams?: number
  /** Grams per count unit, e.g. { tlk: 400, pkt: 400 }. */
  unitGrams?: Record<string, number>
  /** g/ml when Fineli has no DL weight. */
  density?: number
  /**
   * Brand / product-line names that identify this ingredient ("Apetina" = feta-type cheese).
   * Brands are otherwise stripped as noise; these are recognized from the raw line first.
   */
  productNames?: string[]
  /** Word prefixes that turn a compound into a different product ("kookos"+"maito"). */
  notWithPrefixes?: string[]
  scaling?: ScalingRule
  /** Preferred dimension for shopping list quantities. */
  shoppingUnit?: 'mass' | 'volume' | 'count'
  excludeFromShopping?: boolean
  /** Short explanation shown when fineliConfidence < 1. */
  approximationNote?: string
  /**
   * Fineli has no food for this ingredient (only an approximation): the same food in a
   * supplementary database ("usda:2014", see supplementary.ts). Used instead of fineliId when loaded.
   */
  supplementary?: string
  /** How well the supplementary food represents the ingredient (default 0.9: foreign data). */
  supplementaryConfidence?: number
}

type Extra = Partial<Omit<CanonicalIngredient, 'id' | 'fi' | 'en' | 'category' | 'diet' | 'fineliId' | 'aliases'>>

function ing(
  id: string,
  fi: string,
  en: string,
  category: ShoppingCategory,
  diet: Diet,
  fineliId: number | null,
  aliases: string[],
  extra: Extra = {},
): CanonicalIngredient {
  return { id, fi, en, category, diet, fineliId, aliases, fineliConfidence: 1, ...extra }
}

const V = 'vegetables' as const
const M = 'meat_fish' as const
const D = 'dairy' as const
const B = 'bakery' as const
const G = 'dry_goods' as const
const F = 'frozen' as const
const C = 'canned' as const
const S = 'spices_sauces' as const
const O = 'other' as const

const SPICE: Extra = { scaling: 'sublinear', shoppingUnit: 'count' }
const APPROX_SPICE: Extra = {
  ...SPICE,
  fineliConfidence: 0.5,
  approximationNote: 'Fineli ei sisällä tätä maustetta; arvioitu paprikajauheen mukaan (määrät ovat pieniä).',
}
const MILK_LIKE_PREFIXES = ['kookos', 'kaura', 'soija', 'manteli', 'riisi', 'kaakao', 'suklaa', 'mantelin', 'kasvi']

export const INGREDIENTS: CanonicalIngredient[] = [
  // --- Vegetables, fruit, berries, herbs --------------------------------------------------
  ing('onion', 'Sipuli', 'Onion', V, 'vegan', 335, ['sipuli', 'keltasipuli', 'kepasipuli', 'ruokasipuli', 'salottisipuli', 'salotti'], { shoppingUnit: 'count' }),
  ing('red-onion', 'Punasipuli', 'Red onion', V, 'vegan', 34234, ['punasipuli'], { shoppingUnit: 'count' }),
  ing('garlic', 'Valkosipuli', 'Garlic', V, 'vegan', 393, ['valkosipuli', 'valkosipulinkynsi', 'valkosipulin kynsi', 'kynsi valkosipuli', 'valkosipulimurska', 'valkosipulitahna'], { pieceGrams: 4, unitGrams: { kynsi: 4 }, shoppingUnit: 'count' }),
  ing('leek', 'Purjo', 'Leek', V, 'vegan', 337, ['purjo', 'purjosipuli', 'purjonvarsi'], { pieceGrams: 200, shoppingUnit: 'count' }),
  ing('spring-onion', 'Kevätsipuli', 'Spring onion', V, 'vegan', 392, ['kevätsipuli', 'varhaissipuli', 'salaattisipuli'], { pieceGrams: 15, fineliConfidence: 0.8, approximationNote: 'Arvioitu ruohosipulin ravintoarvoilla.' }),
  ing('chives', 'Ruohosipuli', 'Chives', V, 'vegan', 392, ['ruohosipuli'], { unitGrams: { ruukku: 20, nippu: 20, ps: 20 } }),
  ing('carrot', 'Porkkana', 'Carrot', V, 'vegan', 300, ['porkkana', 'porkkanaraaste', 'raastettu porkkana', 'suikaloitu porkkana'], { shoppingUnit: 'count' }),
  ing('potato', 'Peruna', 'Potato', V, 'vegan', 205, ['peruna', 'kiinteä peruna', 'jauhoinen peruna', 'yleisperuna', 'keittoperuna', 'uuniperuna'], { pieceGrams: 80, shoppingUnit: 'mass' }),
  ing('new-potato', 'Uusi peruna', 'New potato', V, 'vegan', 204, ['uusi peruna', 'varhaisperuna'], { pieceGrams: 40, shoppingUnit: 'mass' }),
  ing('sweet-potato', 'Bataatti', 'Sweet potato', V, 'vegan', 30223, ['bataatti', 'maukkaperuna'], { pieceGrams: 300 }),
  ing('tomato', 'Tomaatti', 'Tomato', V, 'vegan', 352, ['tomaatti', 'luumutomaatti', 'kobiratomaatti', 'pensastomaatti', 'tomaattikuutio', 'terttutomaatti', 'tomaatti terttu'], { shoppingUnit: 'count' }),
  ing('cherry-tomato', 'Kirsikkatomaatti', 'Cherry tomato', V, 'vegan', 352, ['kirsikkatomaatti', 'minitomaatti', 'terttukirsikkatomaatti'], { pieceGrams: 15, unitGrams: { rs: 250 }, fineliConfidence: 0.95 }),
  ing('cucumber', 'Kurkku', 'Cucumber', V, 'vegan', 346, ['kurkku', 'kasvihuonekurkku', 'salaattikurkku', 'avomaankurkku'], { shoppingUnit: 'count' }),
  ing('pickled-cucumber', 'Suolakurkku', 'Pickled cucumber', C, 'vegan', 11072, ['suolakurkku', 'hapankurkku', 'venäläinen kurkku']),
  ing('pickle', 'Maustekurkku', 'Pickled gherkin', C, 'vegan', 348, ['maustekurkku', 'etikkakurkku', 'herkkukurkku', 'kurkkusalaatti', 'kurkkurelissi']),
  ing('bell-pepper', 'Paprika', 'Bell pepper', V, 'vegan', 355, ['paprika', 'suippopaprika', 'minipaprika', 'paprikasuikale'], { shoppingUnit: 'count' }),
  ing('chili', 'Chili', 'Chili pepper', V, 'vegan', 31557, ['chili', 'chilipalko', 'chilipippuri', 'punainen chili', 'vihreä chili', 'tuore chili'], { pieceGrams: 10 }),
  ing('jalapeno', 'Jalapeño', 'Jalapeño', C, 'vegan', 33484, ['jalapeno', 'jalapeño', 'jalapenoviipale']),
  ing('zucchini', 'Kesäkurpitsa', 'Zucchini', V, 'vegan', 389, ['kesäkurpitsa', 'zucchini'], { shoppingUnit: 'count' }),
  ing('pumpkin', 'Kurpitsa', 'Pumpkin', V, 'vegan', 350, ['kurpitsa', 'myskikurpitsa', 'hokkaidokurpitsa']),
  ing('eggplant', 'Munakoiso', 'Eggplant', V, 'vegan', 362, ['munakoiso', 'aubergine'], { shoppingUnit: 'count' }),
  ing('broccoli', 'Parsakaali', 'Broccoli', V, 'vegan', 324, ['parsakaali', 'brokkoli', 'parsakaalinkukinto', 'parsakaaliruusuke'], { shoppingUnit: 'count' }),
  ing('cauliflower', 'Kukkakaali', 'Cauliflower', V, 'vegan', 322, ['kukkakaali', 'kukkakaalinkukinto', 'kukkakaaliruusuke'], { shoppingUnit: 'count' }),
  ing('cabbage', 'Valkokaali', 'White cabbage', V, 'vegan', 320, ['valkokaali', 'keräkaali', 'kaali', 'kaalinpää', 'kaalisuikale', 'coleslaw'], { shoppingUnit: 'mass' }),
  ing('red-cabbage', 'Punakaali', 'Red cabbage', V, 'vegan', 321, ['punakaali']),
  ing('chinese-cabbage', 'Kiinankaali', 'Chinese cabbage', V, 'vegan', 359, ['kiinankaali', 'pak choi', 'paksoi']),
  ing('kale', 'Lehtikaali', 'Kale', V, 'vegan', 326, ['lehtikaali', 'kale', 'mustakaali', 'palmukaali']),
  ing('brussels-sprouts', 'Ruusukaali', 'Brussels sprouts', V, 'vegan', 327, ['ruusukaali']),
  ing('iceberg', 'Jäävuorisalaatti', 'Iceberg lettuce', V, 'vegan', 331, ['jäävuorisalaatti', 'keräsalaatti', 'amerikansalaatti', 'rapea keräsalaatti'], { unitGrams: { kera: 500 }, pieceGrams: 500 }),
  ing('lettuce', 'Salaatti', 'Lettuce', V, 'vegan', 330, ['salaatti', 'lehtisalaatti', 'ruukkusalaatti', 'salaatinlehti', 'salaattisekoitus', 'salaattiseos', 'lollo rosso', 'tammenlehtisalaatti', 'vihersalaatti', 'romainesalaatti', 'roomansalaatti', 'minisalaatti', 'babyleaf'], { unitGrams: { ruukku: 100, ps: 100, kera: 300 }, pieceGrams: 100 }),
  ing('rucola', 'Rucola', 'Rocket', V, 'vegan', 34159, ['rucola', 'rukola', 'sinappikaali', 'villirucola'], { unitGrams: { ps: 65, rs: 65 } }),
  ing('spinach', 'Pinaatti', 'Spinach', V, 'vegan', 33456, ['pinaatti', 'babypinaatti', 'lehtipinaatti', 'pinaatinlehti', 'tuore pinaatti'], { unitGrams: { ps: 65, rs: 65 } }),
  ing('frozen-spinach', 'Pakastepinaatti', 'Frozen spinach', F, 'vegan', 34228, ['pakastepinaatti', 'pinaattipakaste', 'pinaattisilppu', 'pakastettu pinaatti', 'pinaattikeko'], { unitGrams: { pkt: 150, ps: 150 } }),
  ing('celery', 'Varsiselleri', 'Celery', V, 'vegan', 339, ['varsiselleri', 'lehtiselleri', 'selleri', 'sellerinvarsi'], { unitGrams: { varsi: 40 }, pieceGrams: 40 }),
  ing('celeriac', 'Juuriselleri', 'Celeriac', V, 'vegan', 311, ['juuriselleri', 'mukulaselleri']),
  ing('beetroot', 'Punajuuri', 'Beetroot', V, 'vegan', 305, ['punajuuri', 'keltajuuri', 'raitajuuri']),
  ing('pickled-beetroot', 'Etikkapunajuuri', 'Pickled beetroot', C, 'vegan', 307, ['etikkapunajuuri', 'säilykepunajuuri', 'punajuurisäilyke']),
  ing('swede', 'Lanttu', 'Swede', V, 'vegan', 303, ['lanttu']),
  ing('parsnip', 'Palsternakka', 'Parsnip', V, 'vegan', 309, ['palsternakka']),
  ing('turnip', 'Nauris', 'Turnip', V, 'vegan', 304, ['nauris']),
  ing('root-veg-mix', 'Keittojuurekset', 'Soup vegetables', V, 'vegan', 11001, ['keittojuures', 'keittojuurekset', 'juuressekoitus', 'juurekset', 'juures'], { fineliConfidence: 0.8 }),
  ing('mushroom', 'Herkkusieni', 'Mushroom', V, 'vegan', 345, ['herkkusieni', 'sieni', 'champignon', 'ruskea herkkusieni', 'portobello', 'metsäsieni', 'sienisekoitus'], { unitGrams: { rs: 250 } }),
  ing('canned-mushroom', 'Herkkusienisäilyke', 'Canned mushrooms', C, 'vegan', 11064, ['herkkusienisäilyke', 'säilykeherkkusieni', 'sienisäilyke']),
  ing('chanterelle', 'Kantarelli', 'Chanterelle', V, 'vegan', 367, ['kantarelli', 'kanttarelli', 'keltavahvero']),
  ing('funnel-chanterelle', 'Suppilovahvero', 'Funnel chanterelle', V, 'vegan', 34240, ['suppilovahvero', 'suppis']),
  ing('corn', 'Maissi', 'Sweetcorn', C, 'vegan', 363, ['maissi', 'maissinjyvä', 'maissijyvä', 'maissisäilyke', 'säilykemaissi'], { unitGrams: { tlk: 285, prk: 285 } }),
  ing('peas', 'Herne', 'Green peas', F, 'vegan', 34229, ['herne', 'pakasteherne', 'tarhaherne', 'vihreä herne', 'herneet'], { unitGrams: { ps: 300, pkt: 300 } }),
  ing('green-beans', 'Vihreä papu', 'Green beans', F, 'vegan', 372, ['vihreä papu', 'taitepapu', 'leikkopapu', 'pavunvarsi', 'haricots verts'], { unitGrams: { ps: 300, pkt: 300 } }),
  ing('veg-mix', 'Kasvissekoitus', 'Frozen vegetable mix', F, 'vegan', 356, ['kasvissekoitus', 'wokkivihannekset', 'wokkikasvikset', 'pakastekasvikset', 'kasvissekoite', 'vihannessekoitus', 'wok-vihannes', 'kasvispakaste'], { unitGrams: { ps: 400, pkt: 400 } }),
  ing('avocado', 'Avokado', 'Avocado', V, 'vegan', 11057, ['avokado', 'avocado'], { shoppingUnit: 'count' }),
  ing('lemon', 'Sitruuna', 'Lemon', V, 'vegan', 11048, ['sitruuna'], { shoppingUnit: 'count' }),
  ing('lemon-juice', 'Sitruunamehu', 'Lemon juice', V, 'vegan', 11048, ['sitruunamehu', 'sitruunan mehu', 'puristettu sitruunamehu'], { fineliConfidence: 0.8, approximationNote: 'Arvioitu sitruunan ravintoarvoilla.', density: 1 }),
  ing('lemon-zest', 'Sitruunankuori', 'Lemon zest', V, 'vegan', 11048, ['sitruunankuori', 'sitruunan kuori', 'sitruunankuoriraaste', 'raastettu sitruunankuori'], { fineliConfidence: 0.6, density: 0.5, supplementary: 'usda:9156' }),
  ing('lime', 'Limetti', 'Lime', V, 'vegan', 11048, ['limetti', 'limettimehu', 'limetin mehu', 'limetinkuori'], { fineliConfidence: 0.85, pieceGrams: 60, approximationNote: 'Arvioitu sitruunan ravintoarvoilla.' }),
  ing('apple', 'Omena', 'Apple', V, 'vegan', 28941, ['omena', 'omenalohko', 'vihreä omena'], { shoppingUnit: 'count' }),
  ing('banana', 'Banaani', 'Banana', V, 'vegan', 11049, ['banaani'], { shoppingUnit: 'count' }),
  ing('orange', 'Appelsiini', 'Orange', V, 'vegan', 11045, ['appelsiini', 'veriappelsiini'], { shoppingUnit: 'count' }),
  ing('pear', 'Päärynä', 'Pear', V, 'vegan', 11062, ['päärynä'], { shoppingUnit: 'count' }),
  ing('kiwi', 'Kiivi', 'Kiwi', V, 'vegan', 11050, ['kiivi', 'kiwi']),
  ing('mango', 'Mango', 'Mango', V, 'vegan', 34361, ['mango', 'mangokuutio']),
  ing('pineapple', 'Ananas', 'Pineapple', V, 'vegan', 11056, ['ananas', 'tuore ananas']),
  ing('canned-pineapple', 'Ananassäilyke', 'Canned pineapple', C, 'vegan', 471, ['ananassäilyke', 'ananasmurska', 'ananaspala', 'ananasrengas', 'säilykeananas'], { unitGrams: { tlk: 340 } }),
  ing('grape', 'Viinirypäle', 'Grapes', V, 'vegan', 423, ['viinirypäle', 'rypäle']),
  ing('blueberry', 'Mustikka', 'Blueberry', F, 'vegan', 442, ['mustikka', 'metsämustikka', 'pensasmustikka']),
  ing('strawberry', 'Mansikka', 'Strawberry', V, 'vegan', 447, ['mansikka']),
  ing('raspberry', 'Vadelma', 'Raspberry', F, 'vegan', 448, ['vadelma']),
  ing('lingonberry', 'Puolukka', 'Lingonberry', F, 'vegan', 440, ['puolukka']),
  ing('berries', 'Marjat', 'Berries', F, 'vegan', 454, ['marja', 'marjat', 'sekamarja', 'pakastemarja', 'marjasekoitus', 'metsämarja'], { fineliConfidence: 0.9 }),
  ing('raisin', 'Rusina', 'Raisins', G, 'vegan', 428, ['rusina', 'sultanarusina']),
  ing('dried-apricot', 'Kuivattu aprikoosi', 'Dried apricot', G, 'vegan', 409, ['kuivattu aprikoosi', 'kuivaaprikoosi']),
  ing('date', 'Taateli', 'Dates', G, 'vegan', 28937, ['taateli']),
  ing('ginger', 'Inkivääri', 'Ginger', V, 'vegan', 33023, ['inkivääri', 'tuore inkivääri', 'inkiväärinjuuri', 'inkivääriraaste'], { density: 0.5 }),
  ing('basil', 'Basilika', 'Basil', V, 'vegan', 11134, ['basilika', 'tuore basilika', 'basilikanlehti', 'thaibasilika'], { unitGrams: { ruukku: 20, nippu: 20 } }),
  ing('parsley', 'Persilja', 'Parsley', V, 'vegan', 333, ['persilja', 'lehtipersilja', 'kiharapersilja', 'persiljasilppu'], { unitGrams: { ruukku: 20, nippu: 20 } }),
  ing('dill', 'Tilli', 'Dill', V, 'vegan', 369, ['tilli', 'tillisilppu', 'tillinoksa'], { unitGrams: { ruukku: 20, nippu: 20 } }),
  ing('coriander', 'Korianteri', 'Coriander', V, 'vegan', 34238, ['korianteri', 'tuore korianteri', 'korianterinlehti'], { unitGrams: { ruukku: 20, nippu: 20 } }),
  ing('mint', 'Minttu', 'Mint', V, 'vegan', 11134, ['minttu', 'piparminttu', 'mintunlehti'], { fineliConfidence: 0.6, unitGrams: { ruukku: 20 }, approximationNote: 'Arvioitu basilikan ravintoarvoilla.', supplementary: 'usda:2064' }),

  // --- Meat, poultry, fish ----------------------------------------------------------------
  ing('chicken-breast-strips', 'Broilerin fileesuikale', 'Chicken breast strips', M, 'meat', 11565, [
    'broilerin fileesuikale', 'broilerin filesuikale', 'broilerin suikale', 'broilerinsuikale', 'broilerisuikale',
    'broilerin fileesuikaleet', 'kanasuikale', 'kanafileesuikale', 'kanan fileesuikale', 'broilerin fileepala',
    'broilerin sisäfileesuikale', 'fileesuikale', 'kanansuikale', 'broilerin kebabsuikale', 'maustamaton broilerin fileesuikale',
  ], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('chicken-strips-marinated', 'Maustettu broilerin fileesuikale', 'Marinated chicken strips', M, 'meat', 11150, [
    'maustettu broilerin fileesuikale', 'marinoitu broilerin fileesuikale', 'marinoitu kanasuikale', 'maustettu kanasuikale',
    'hunajamarinoitu broilerin fileesuikale', 'maustettu broilerin suikale',
  ], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('chicken-breast', 'Broilerin rintafilee', 'Chicken breast', M, 'meat', 11565, [
    'broilerin rintafilee', 'broilerin filee', 'broilerinfilee', 'kananrintafilee', 'kanafilee', 'kananfilee',
    'broilerin sisäfilee', 'kanan rintafilee', 'broilerin fileepihvi', 'rintafilee', 'broilerin rintaleike',
    'kanan filee', 'broilerifilee', 'broilerin rintafile', 'broilerin file', 'kanan rintafile', 'kanafile', 'rintafile',
  ], { pieceGrams: 150, unitGrams: { pkt: 600, rs: 600 } }),
  ing('chicken-thigh', 'Broilerin koipireisi', 'Chicken thigh', M, 'meat', 30792, [
    'broilerin koipireisi', 'broilerin koipi', 'kanankoipi', 'broilerin reisi', 'broilerin reisifilee', 'kananreisi',
    'broilerin paistileike', 'reisifilee', 'broilerin reisipala', 'kanan reisifilee', 'broilerin fileepala reisi', 'broilerin pala', 'broilerinpala', 'kananpala', 'kanan pala', 'broilerin koipi ja reisi',
  ], { pieceGrams: 150, unitGrams: { pkt: 600, rs: 600 } }),
  ing('chicken-whole', 'Broileri', 'Whole chicken', M, 'meat', 751, ['broileri', 'kokonainen broileri', 'kana', 'kokobroileri', 'broilerin siipi', 'kananpoika'], { pieceGrams: 1200, fineliConfidence: 0.9 }),
  ing('chicken-mince', 'Broilerin jauheliha', 'Chicken mince', M, 'meat', 28930, ['broilerin jauheliha', 'kanajauheliha', 'broilerijauheliha', 'kanan jauheliha'], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('turkey', 'Kalkkunan rintafilee', 'Turkey breast', M, 'meat', 11551, ['kalkkunan rintafilee', 'kalkkuna', 'kalkkunafilee', 'kalkkunan filee', 'kalkkunasuikale', 'kalkkunan fileesuikale']),
  ing('turkey-mince', 'Kalkkunan jauheliha', 'Turkey mince', M, 'meat', 28945, ['kalkkunan jauheliha', 'kalkkunajauheliha'], { unitGrams: { pkt: 400 } }),
  ing('beef-mince', 'Naudan jauheliha', 'Beef mince', M, 'meat', 11562, ['naudan jauheliha', 'naudanjauheliha', 'nautajauheliha', 'härän jauheliha', 'naudan paistijauheliha', 'nauta jauheliha'], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('beef-mince-lean', 'Vähärasvainen naudan jauheliha', 'Lean beef mince', M, 'meat', 712, ['vähärasvainen naudan jauheliha', 'naudan jauheliha 7 %', 'naudan jauheliha 7%', 'naudan jauheliha 10%', 'kevyt naudan jauheliha'], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('mixed-mince', 'Sika-naudan jauheliha', 'Pork and beef mince', M, 'meat', 711, ['jauheliha', 'sika-nauta jauheliha', 'sika-nautajauheliha', 'sikanautajauheliha', 'sika-naudan jauheliha', 'sekajauheliha', 'jauhelihaseos'], { unitGrams: { pkt: 400, rs: 400 }, fineliConfidence: 0.95 }),
  ing('pork-mince', 'Sian jauheliha', 'Pork mince', M, 'meat', 28946, ['sian jauheliha', 'porsaan jauheliha', 'possun jauheliha', 'sianjauheliha'], { unitGrams: { pkt: 400 } }),
  ing('lamb-mince', 'Lampaan jauheliha', 'Lamb mince', M, 'meat', 28929, ['lampaan jauheliha', 'karitsan jauheliha']),
  ing('beef-strips', 'Naudan suikale', 'Beef strips', M, 'meat', 34201, ['naudan suikale', 'naudanlihasuikale', 'naudan fileesuikale', 'härän suikale', 'naudan lihasuikale', 'naudan sisäpaistisuikale', 'naudanliha', 'naudan liha', 'naudan ulkopaisti', 'naudan sisäpaisti'], { unitGrams: { pkt: 400, rs: 400 } }),
  ing('beef-strips-marinated', 'Maustettu naudan suikale', 'Marinated beef strips', M, 'meat', 31145, ['maustettu naudan suikale', 'marinoitu naudan suikale', 'marinoitu naudanlihasuikale'], { unitGrams: { pkt: 400 } }),
  ing('beef-stew', 'Naudan kastikeliha', 'Beef stewing meat', M, 'meat', 34183, ['naudan kastikeliha', 'naudan palapaisti', 'naudan paistikuutio', 'naudan patapala', 'naudan keittoliha', 'härän palapaisti', 'naudan lapa', 'naudan etuselkä', 'naudan paahtopaisti'], { unitGrams: { pkt: 500 } }),
  ing('beef-fillet', 'Naudan ulkofilee', 'Beef sirloin', M, 'meat', 722, ['naudan ulkofilee', 'naudan sisäfilee', 'naudan filee', 'naudanfilee', 'härän filee', 'naudan pihvi', 'pihvi', 'entrecote', 'naudan entrecote', 'ribeye', 'naudan kylki']),
  ing('pork-strips', 'Porsaan suikale', 'Pork strips', M, 'meat', 34185, ['porsaan suikale', 'sian suikale', 'porsaan fileesuikale', 'possun suikale', 'porsaansuikale', 'sianlihasuikale', 'porsaan lihasuikale', 'porsaan kebabsuikale'], { unitGrams: { pkt: 400 } }),
  ing('pork-strips-marinated', 'Maustettu porsaan suikale', 'Marinated pork strips', M, 'meat', 31144, ['maustettu porsaan suikale', 'marinoitu porsaan suikale', 'marinoitu sianlihasuikale'], { unitGrams: { pkt: 400 } }),
  ing('pork-fillet', 'Porsaan filee', 'Pork fillet', M, 'meat', 11513, ['porsaan sisäfilee', 'porsaan ulkofilee', 'porsaan filee', 'porsaanfilee', 'possun filee', 'sian filee', 'porsaan fileepihvi']),
  ing('pork-chop', 'Porsaankyljys', 'Pork chop', M, 'meat', 11512, ['porsaankyljys', 'porsaan kyljys', 'kyljys', 'siankyljys', 'porsaan grillikylki'], { pieceGrams: 150 }),
  ing('pork-stew', 'Porsaan kastikeliha', 'Pork stewing meat', M, 'meat', 34189, ['porsaan kastikeliha', 'sian kastikeliha', 'porsaan palapaisti', 'porsaan lapa', 'sianlapa', 'porsaan niska', 'porsaanniska', 'sianliha', 'porsaanliha', 'possu', 'porsaan paisti', 'kassler'], { unitGrams: { pkt: 500 } }),
  ing('bacon', 'Pekoni', 'Bacon', M, 'meat', 707, ['pekoni', 'pekonisuikale', 'pekonikuutio', 'pekoniviipale', 'kinkkupekoni'], { unitGrams: { pkt: 140, viipale: 15 }, pieceGrams: 15 }),
  ing('ham', 'Kinkku', 'Ham', M, 'meat', 779, ['kinkku', 'keittokinkku', 'kinkkusuikale', 'kinkkuleike', 'kinkkukuutio', 'savukinkku', 'palvikinkku', 'kinkkuviipale', 'leikkele'], { unitGrams: { pkt: 150, viipale: 12 }, pieceGrams: 12 }),
  ing('prosciutto', 'Ilmakuivattu kinkku', 'Prosciutto', M, 'meat', 30801, ['ilmakuivattu kinkku', 'parmankinkku', 'serranokinkku', 'prosciutto'], { unitGrams: { pkt: 80, viipale: 10 } }),
  ing('sausage', 'Makkara', 'Sausage', M, 'meat', 30318, ['makkara', 'lenkkimakkara', 'lenkki', 'kabanossi', 'metvursti'], { unitGrams: { pkt: 400 }, fineliConfidence: 0.9 }),
  ing('grill-sausage', 'Grillimakkara', 'Grill sausage', M, 'meat', 30572, ['grillimakkara', 'bratwursti', 'grillinakki']),
  ing('hot-dog', 'Nakki', 'Frankfurter', M, 'meat', 30317, ['nakki', 'wieninnakki', 'kanalanakki', 'nakkimakkara'], { pieceGrams: 30, unitGrams: { pkt: 300 } }),
  ing('chorizo', 'Chorizo', 'Chorizo', M, 'meat', 32724, ['chorizo', 'chorizomakkara']),
  ing('salami', 'Salami', 'Salami', M, 'meat', 30306, ['salami', 'meetvursti', 'pepperoni'], { unitGrams: { pkt: 100, viipale: 6 } }),
  ing('lamb', 'Lampaanliha', 'Lamb', M, 'meat', 730, ['lampaanliha', 'karitsa', 'karitsanliha', 'lammas', 'lampaan paisti', 'lampaanpaisti']),
  ing('reindeer', 'Poronliha', 'Reindeer', M, 'meat', 734, ['poronliha', 'poronkäristys', 'poro', 'poronkäristyskäristys', 'käristys']),
  ing('moose', 'Hirvenliha', 'Moose', M, 'meat', 735, ['hirvenliha', 'hirvi', 'riista', 'riistaliha']),
  ing('salmon', 'Lohifilee', 'Salmon fillet', M, 'fish', 871, ['lohi', 'lohifilee', 'lohifileepala', 'lohikuutio', 'lohipala', 'norjanlohi', 'merilohi', 'lohisuikale'], { pieceGrams: 125 }),
  ing('rainbow-trout', 'Kirjolohifilee', 'Rainbow trout', M, 'fish', 33419, ['kirjolohi', 'kirjolohifilee', 'kirjolohifileepala', 'raudus', 'nieriä', 'taimen']),
  ing('smoked-salmon', 'Kylmäsavulohi', 'Cold-smoked salmon', M, 'fish', 33420, ['kylmäsavulohi', 'kylmäsavustettu lohi', 'savulohi', 'kylmäsavustettu kirjolohi', 'kylmäsavukirjolohi'], { unitGrams: { pkt: 150 } }),
  ing('hot-smoked-salmon', 'Lämminsavulohi', 'Hot-smoked salmon', M, 'fish', 33382, ['lämminsavulohi', 'lämminsavustettu lohi', 'lämminsavustettu kirjolohi', 'savustettu lohi']),
  ing('gravlax', 'Graavilohi', 'Gravlax', M, 'fish', 818, ['graavilohi', 'graavisuolattu lohi', 'tuoresuolattu lohi']),
  ing('white-fish', 'Vaalea kala', 'White fish', M, 'fish', 804, ['turska', 'turskafilee', 'seiti', 'seitifilee', 'kolja', 'koljafilee', 'vaalea kala', 'kalafilee', 'vaalea kalafilee', 'pangasius', 'pangasiusfilee', 'tilapia', 'hoki', 'kuha', 'kuhafilee', 'ahven', 'ahvenfilee', 'hauki', 'haukifilee', 'siika', 'siikafilee', 'kampela', 'kala'], { fineliConfidence: 0.9 }),
  ing('tuna', 'Tonnikala', 'Canned tuna', C, 'fish', 11067, ['tonnikala', 'tonnikalasäilyke', 'tonnikala vedessä', 'tonnikalapala', 'tonnikalamurska', 'tonnikalafilee'], { unitGrams: { tlk: 150, prk: 150 } }),
  ing('tuna-oil', 'Tonnikala öljyssä', 'Tuna in oil', C, 'fish', 828, ['tonnikala öljyssä', 'öljytonnikala'], { unitGrams: { tlk: 150 } }),
  ing('shrimp', 'Katkarapu', 'Shrimp', F, 'fish', 835, ['katkarapu', 'jättikatkarapu', 'kuningaskatkarapu', 'tiikerirapu', 'jääkatkarapu', 'katkarapu liemessä', 'kuorittu katkarapu'], { unitGrams: { pkt: 300, ps: 300 } }),
  ing('mussel', 'Sinisimpukka', 'Mussels', M, 'fish', 834, ['sinisimpukka', 'simpukka']),
  ing('baltic-herring', 'Silakka', 'Baltic herring', M, 'fish', 29207, ['silakka', 'silakkafilee', 'silakkapihvi']),
  ing('pickled-herring', 'Maustesilli', 'Pickled herring', C, 'fish', 837, ['silli', 'maustesilli', 'sillifilee', 'matjessilli', 'lasimestarinsilli']),
  ing('vendace', 'Muikku', 'Vendace', M, 'fish', 809, ['muikku']),
  ing('anchovy', 'Anjovis', 'Anchovy', C, 'fish', 829, ['anjovis', 'sardelli', 'anjovisfilee']),
  ing('fish-roe', 'Mäti', 'Fish roe', M, 'fish', 11691, ['mäti', 'muikunmäti', 'siianmäti', 'kirjolohenmäti']),

  // --- Dairy & eggs -------------------------------------------------------------------------
  ing('milk', 'Maito', 'Milk', D, 'vegetarian', 33466, ['maito', 'maitojuoma'], { notWithPrefixes: MILK_LIKE_PREFIXES, shoppingUnit: 'volume', fineliConfidence: 0.95 }),
  ing('milk-semi', 'Kevytmaito', 'Semi-skimmed milk', D, 'vegetarian', 684, ['kevytmaito', 'kevytmaitojuoma', 'kevyt maito', 'laktoositon kevytmaitojuoma', 'kevytmaito 1,5 %', 'hyla kevytmaito'], { shoppingUnit: 'volume' }),
  ing('milk-skimmed', 'Rasvaton maito', 'Skimmed milk', D, 'vegetarian', 606, ['rasvaton maito', 'rasvaton maitojuoma', 'rasvaton', 'kurri'], { shoppingUnit: 'volume' }),
  ing('milk-whole', 'Täysmaito', 'Whole milk', D, 'vegetarian', 689, ['täysmaito', 'täysmaitojuoma', 'täysmaito 3,5 %'], { shoppingUnit: 'volume' }),
  ing('milk-1pct', 'Ykkösmaito', '1 % milk', D, 'vegetarian', 627, ['ykkösmaito', 'ykkösmaitojuoma'], { shoppingUnit: 'volume' }),
  ing('cream', 'Kuohukerma', 'Whipping cream', D, 'vegetarian', 631, ['kuohukerma', 'vispikerma', 'kerma', 'vispautuva kerma', 'täysrasvainen kerma', 'kuohukerma 35 %', 'kermavaahto'], { notWithPrefixes: ['kasvi', 'kaura', 'soija', 'kookos', 'hapan', 'kahvi', 'ruoanvalmistus', 'ruoka'], shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('cooking-cream', 'Ruoanvalmistuskerma', 'Cooking cream', D, 'vegetarian', 29065, ['ruoanvalmistuskerma', 'ruokakerma', 'kevyt ruoanvalmistuskerma', 'kevytkerma', 'laktoositon ruoanvalmistuskerma', 'ruoanvalmistusvalmiste'], { shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('plant-cream', 'Kasvirasvakerma', 'Vegetable-fat cream', D, 'vegetarian', 699, ['kasvirasvakerma', 'kasvirasvasekoite', 'kasvirasvaruokakerma', 'ruokakerma kasvirasvasekoite'], { shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('coffee-cream', 'Kahvikerma', 'Coffee cream', D, 'vegetarian', 633, ['kahvikerma', 'kevytkahvikerma'], { shoppingUnit: 'volume' }),
  ing('creme-fraiche', 'Ranskankerma', 'Crème fraîche', D, 'vegetarian', 11159, ['ranskankerma', 'creme fraiche', 'crème fraîche', 'creme fraîche'], { shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('sour-cream', 'Kermaviili', 'Sour cream', D, 'vegetarian', 615, ['kermaviili', 'hapankerma', 'kevytkermaviili'], { shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('smetana', 'Smetana', 'Smetana', D, 'vegetarian', 630, ['smetana'], { shoppingUnit: 'volume', unitGrams: { prk: 200 } }),
  ing('greek-yogurt', 'Turkkilainen jogurtti', 'Greek yogurt', D, 'vegetarian', 32201, ['turkkilainen jogurtti', 'kreikkalainen jogurtti', 'kreikkalaistyylinen jogurtti', 'turkkilaistyylinen jogurtti'], { unitGrams: { prk: 200, tlk: 200 } }),
  ing('yogurt', 'Maustamaton jogurtti', 'Plain yogurt', D, 'vegetarian', 33162, ['jogurtti', 'maustamaton jogurtti', 'luonnonjogurtti', 'maustamaton luonnonjogurtti', 'turkinjogurtti', 'ruoanvalmistusjogurtti'], { notWithPrefixes: ['soija', 'kaura', 'kookos'] }),
  ing('quark', 'Maitorahka', 'Quark', D, 'vegetarian', 622, ['rahka', 'maitorahka', 'maustamaton rahka', 'maustamaton maitorahka', 'kermarahka'], { unitGrams: { prk: 250, pkt: 250, tlk: 250 } }),
  ing('viili', 'Viili', 'Viili', D, 'vegetarian', 618, ['viili', 'kevytviili', 'maustamaton viili']),
  ing('buttermilk', 'Piimä', 'Buttermilk', D, 'vegetarian', 611, ['piimä', 'kirnupiimä', 'kevytpiimä', 'rasvaton piimä'], { shoppingUnit: 'volume' }),
  ing('cottage-cheese', 'Raejuusto', 'Cottage cheese', D, 'vegetarian', 649, ['raejuusto', 'kevytraejuusto'], { unitGrams: { prk: 200, rs: 200 } }),
  ing('cream-cheese', 'Tuorejuusto', 'Cream cheese', D, 'vegetarian', 11571, ['tuorejuusto', 'maustamaton tuorejuusto', 'kermatuorejuusto', 'philadelphia', 'ruoanvalmistustuorejuusto'], { unitGrams: { prk: 200, rs: 200, pkt: 200 }, productNames: ['philadelphia', 'viola'] }),
  ing('cream-cheese-flavoured', 'Maustettu tuorejuusto', 'Flavoured cream cheese', D, 'vegetarian', 682, ['maustettu tuorejuusto', 'valkosipulituorejuusto', 'yrttituorejuusto', 'valkosipuli-yrttituorejuusto', 'pippurituorejuusto', 'tuorejuusto valkosipuli'], { unitGrams: { prk: 200, rs: 200 }, productNames: ['creme bonjour', 'crème bonjour', 'cantadou'] }),
  ing('mascarpone', 'Mascarpone', 'Mascarpone', D, 'vegetarian', 34752, ['mascarpone', 'mascarponejuusto'], { unitGrams: { prk: 250, rs: 250 } }),
  ing('butter', 'Voi', 'Butter', D, 'vegetarian', 500, ['voi', 'suolaton voi', 'normaalisuolainen voi', 'laktoositon voi', 'ruokavoi', 'voinokare', 'sulatettu voi', 'voisula'], { notWithPrefixes: ['maapähkinä', 'kaakao', 'shea', 'manteli', 'cashew', 'yrtti', 'valkosipuli'], unitGrams: { pkt: 500 } }),
  ing('margarine', 'Margariini', 'Margarine', D, 'vegan', 568, ['margariini', 'rasvalevite', 'levite', 'kasvimargariini', 'leivontamargariini', 'kasvirasvalevite', 'rasvaseos', 'voi-kasviöljyseos', 'kasvirasva'], { fineliConfidence: 0.9, productNames: ['keiju', 'flora', 'becel', 'oivariini'] }),
  ing('liquid-margarine', 'Juokseva kasviöljyvalmiste', 'Liquid margarine', D, 'vegan', 32553, ['juokseva margariini', 'juokseva kasviöljyvalmiste', 'kasviöljyvalmiste', 'juokseva kasvirasvavalmiste', 'paistomargariini', 'juokseva rasva']),
  ing('cheese', 'Juusto', 'Cheese', D, 'vegetarian', 643, ['juusto', 'edam', 'edamjuusto', 'juustoviipale', 'kermajuusto', 'gouda', 'goudajuusto', 'arkijuusto', 'voileipäjuusto', 'kevytjuusto', 'viipalejuusto', 'juustokuutio'], { notWithPrefixes: ['tuore', 'rae', 'sulate', 'leipä', 'sinihome', 'valkohome', 'vuohen', 'salaatti', 'feta'], unitGrams: { viipale: 8 }, productNames: ['oltermanni', 'polar', 'turunmaa'] }),
  ing('grated-cheese', 'Juustoraaste', 'Grated cheese', D, 'vegetarian', 643, ['juustoraaste', 'raastettu juusto', 'pizzajuusto', 'pizzajuustoraaste', 'gratinointijuusto', 'raaste', 'mozzarella-cheddar-raaste', 'kevytjuustoraaste'], { fineliConfidence: 0.9, unitGrams: { ps: 150, pkt: 150 }, density: 0.45 }),
  ing('emmental', 'Emmental', 'Emmental', D, 'vegetarian', 642, ['emmental', 'emmentaljuusto', 'emmentaljuustoraaste', 'emmentalraaste', 'punaleima-emmental', 'punaleimaemmental', 'gruyere', 'gruyère'], { unitGrams: { ps: 150 }, density: 0.45 }),
  ing('mozzarella', 'Mozzarella', 'Mozzarella', D, 'vegetarian', 29239, ['mozzarella', 'mozzarellajuusto', 'mozzarellaraaste', 'mozzarella raaste', 'buffalomozzarella', 'mozzarellapallo', 'minimozzarella', 'burrata'], { unitGrams: { ps: 150, pkt: 125, kpl: 125 }, pieceGrams: 125, density: 0.45 }),
  ing('parmesan', 'Parmesaani', 'Parmesan', D, 'vegetarian', 691, ['parmesaani', 'parmesaanijuusto', 'parmigiano', 'parmigiano reggiano', 'grana padano', 'pecorino', 'parmesaaniraaste', 'parmesan'], { fineliConfidence: 0.75, density: 0.4, approximationNote: 'Arvioitu kovan suurikoloisen juuston (gruyère) ravintoarvoilla.' }),
  ing('feta', 'Fetajuusto', 'Feta', D, 'vegetarian', 690, ['feta', 'fetajuusto', 'salaattijuusto', 'fetamuru', 'fetakuutio', 'salaattijuustokuutio', 'fetapala'], { fineliConfidence: 0.9, unitGrams: { pkt: 200, prk: 200, rs: 200 }, productNames: ['apetina'] }),
  ing('halloumi', 'Halloumi', 'Halloumi', D, 'vegetarian', 33465, ['halloumi', 'grillijuusto', 'paistojuusto'], { unitGrams: { pkt: 200 } }),
  ing('blue-cheese', 'Sinihomejuusto', 'Blue cheese', D, 'vegetarian', 653, ['sinihomejuusto', 'aura', 'aurajuusto', 'gorgonzola', 'roquefort'], { productNames: ['aura'] }),
  ing('brie', 'Valkohomejuusto', 'Brie / Camembert', D, 'vegetarian', 640, ['valkohomejuusto', 'brie', 'camembert', 'briejuusto']),
  ing('goat-cheese', 'Vuohenjuusto', 'Goat cheese', D, 'vegetarian', 32925, ['vuohenjuusto', 'chevre', 'chèvre', 'vuohentuorejuusto']),
  ing('cheddar', 'Cheddar', 'Cheddar', D, 'vegetarian', 698, ['cheddar', 'cheddarjuusto', 'cheddarraaste']),
  ing('leipajuusto', 'Leipäjuusto', 'Finnish squeaky cheese', D, 'vegetarian', 657, ['leipäjuusto', 'juustoleipä']),
  ing('processed-cheese', 'Sulatejuusto', 'Processed cheese', D, 'vegetarian', 647, ['sulatejuusto', 'koskenlaskija', 'hamburgerjuusto', 'juustoviipale sulate'], { productNames: ['koskenlaskija'] }),
  ing('egg', 'Kananmuna', 'Egg', D, 'vegetarian', 858, ['kananmuna', 'muna', 'luomukananmuna', 'vapaan kanan muna', 'kananmunat'], { pieceGrams: 55, shoppingUnit: 'count' }),
  ing('egg-yolk', 'Kananmunan keltuainen', 'Egg yolk', D, 'vegetarian', 851, ['keltuainen', 'kananmunan keltuainen', 'munankeltuainen'], { pieceGrams: 18, shoppingUnit: 'count' }),
  ing('egg-white', 'Kananmunan valkuainen', 'Egg white', D, 'vegetarian', 852, ['valkuainen', 'kananmunan valkuainen', 'munanvalkuainen'], { pieceGrams: 35, shoppingUnit: 'count' }),
  ing('oat-drink', 'Kaurajuoma', 'Oat drink', D, 'vegan', 33596, ['kaurajuoma', 'kaurajuoma maustamaton', 'kaura-maitojuoma', 'kauramaito'], { shoppingUnit: 'volume' }),
  ing('oat-cream', 'Kaurakerma', 'Oat cream', D, 'vegan', 32005, ['kaurakerma', 'kaura ruoanvalmistusvalmiste', 'kauraruoanvalmistusvalmiste', 'kaurapohjainen ruoanvalmistusvalmiste', 'kaurafraiche', 'kauravalmiste'], { shoppingUnit: 'volume', unitGrams: { prk: 200, tlk: 200 } }),
  ing('oat-yogurt', 'Kaurajogurtti', 'Oat yogurt', D, 'vegan', 32562, ['kaurajogurtti', 'kaurapohjainen välipala', 'hapatettu kauravalmiste', 'kaurajogurtti maustamaton']),
  ing('soy-drink', 'Soijajuoma', 'Soy drink', D, 'vegan', 33597, ['soijajuoma', 'soijamaito'], { shoppingUnit: 'volume' }),
  ing('soy-cream', 'Soijakerma', 'Soy cream', D, 'vegan', 32004, ['soijakerma', 'soijapohjainen ruoanvalmistusvalmiste', 'soija ruoanvalmistusvalmiste'], { shoppingUnit: 'volume' }),
  ing('soy-yogurt', 'Soijajogurtti', 'Soy yogurt', D, 'vegan', 33452, ['soijajogurtti', 'soijavälipala', 'soijapohjainen jogurtti']),
  ing('almond-drink', 'Mantelijuoma', 'Almond drink', D, 'vegan', 34738, ['mantelijuoma', 'mantelimaito'], { shoppingUnit: 'volume' }),

  // --- Bakery -----------------------------------------------------------------------------
  ing('rye-bread', 'Ruisleipä', 'Rye bread', B, 'vegan', 1331, ['ruisleipä', 'ruispala', 'reissumies', 'ruisleipäviipale', 'ruislimppu', 'jälkiuunileipä', 'ruisleivänpala', 'ruissämpylä', 'ruisvuoka'], { fineliConfidence: 0.95, unitGrams: { viipale: 35 } }),
  ing('oat-bread', 'Kauraleipä', 'Oat bread', B, 'vegetarian', 1520, ['kauraleipä', 'kaurapala', 'kaurasämpylä', 'kauraleipäviipale'], { unitGrams: { viipale: 30 }, pieceGrams: 30 }),
  ing('white-bread', 'Paahtoleipä', 'White toast bread', B, 'vegan', 29795, ['paahtoleipä', 'vaalea leipä', 'vehnäleipä', 'toastileipä', 'leipäviipale', 'leipä', 'vaalea paahtoleipä', 'saaristolaisleipä', 'maalaisleipä', 'hapanjuurileipä', 'focaccia', 'ciabatta'], { fineliConfidence: 0.9, unitGrams: { viipale: 25 }, pieceGrams: 25 }),
  ing('multigrain-bread', 'Moniviljaleipä', 'Multigrain bread', B, 'vegan', 29806, ['moniviljaleipä', 'monivilja paahtoleipä', 'täysjyväpaahtoleipä', 'täysjyväleipä', 'siemenleipä', 'grahamleipä'], { unitGrams: { viipale: 30 }, pieceGrams: 30 }),
  ing('baguette', 'Patonki', 'Baguette', B, 'vegan', 29795, ['patonki', 'ranskanleipä', 'baguette', 'minipatonki'], { fineliConfidence: 0.8, pieceGrams: 250, approximationNote: 'Arvioitu vaalean vehnäleivän ravintoarvoilla.' }),
  ing('bun', 'Sämpylä', 'Bread roll', B, 'vegetarian', 1108, ['sämpylä', 'vehnäsämpylä', 'hampurilaissämpylä', 'hampurilaisleipä', 'briossisämpylä', 'hodarisämpylä', 'hot dog -sämpylä', 'pitaleipä', 'pita', 'nanleipä', 'naan'], { pieceGrams: 60, fineliConfidence: 0.9 }),
  ing('crispbread', 'Näkkileipä', 'Crispbread', B, 'vegan', 29771, ['näkkileipä', 'ruisnäkkileipä', 'hapankorppu'], { pieceGrams: 12 }),
  ing('tortilla', 'Tortilla', 'Tortilla', B, 'vegan', 30186, ['tortilla', 'vehnätortilla', 'tortillalevy', 'tortillalettu', 'wrap', 'wrap-leipä', 'wrapleipä', 'burritolettu', 'fajitalettu', 'tortillaleipä', 'täysjyvätortilla', 'minitortilla'], { unitGrams: { pkt: 320 } }),
  ing('taco-shell', 'Tacokuori', 'Taco shell', B, 'vegan', 184, ['tacokuori', 'tacokuoret', 'taco shell', 'tortillalastu', 'maissilastu', 'nachos', 'nacholastu', 'tortillasipsi'], { unitGrams: { pkt: 135 } }),
  ing('pizza-dough', 'Pizzapohja', 'Pizza dough', B, 'vegan', 32747, ['pizzapohja', 'pizzataikina', 'valmis pizzapohja'], { pieceGrams: 400 }),
  ing('puff-pastry', 'Lehtitaikina', 'Puff pastry', F, 'vegetarian', 31672, ['lehtitaikina', 'voitaikina', 'lehtitaikinalevy', 'voitaikinalevy', 'croissanttaikina'], { fineliConfidence: 0.8, unitGrams: { levy: 75, pkt: 500 }, approximationNote: 'Arvioitu paistetun voitaikinan ravintoarvoilla.' }),
  ing('breadcrumbs', 'Korppujauho', 'Breadcrumbs', G, 'vegan', 126, ['korppujauho', 'pankojauho', 'panko', 'korppujauhe']),

  // --- Dry goods -------------------------------------------------------------------------
  ing('pasta', 'Pasta', 'Pasta', G, 'vegan', 121, ['pasta', 'spagetti', 'makaroni', 'penne', 'fusilli', 'tagliatelle', 'farfalle', 'linguine', 'pastakierre', 'maccheroni', 'rigatoni', 'nauhapasta', 'simpukkapasta', 'kierrepasta', 'kuivapasta', 'orzo', 'conchiglie', 'pappardelle', 'fettuccine', 'bucatini', 'pastakuori', 'putkipasta', 'kiemuramakaroni', 'lyhytpasta'], { unitGrams: { pkt: 500, ps: 500 } }),
  ing('wholegrain-pasta', 'Täysjyväpasta', 'Wholegrain pasta', G, 'vegan', 34713, ['täysjyväpasta', 'täysjyväspagetti', 'täysjyvämakaroni', 'tumma pasta', 'tumma spagetti', 'täysjyväpenne', 'täysjyväfusilli', 'tumma makaroni', 'täysjyvä pasta', 'täysjyvätagliatelle', 'kuitupasta'], { unitGrams: { pkt: 500, ps: 500 } }),
  ing('lasagne-sheet', 'Lasagnelevy', 'Lasagne sheets', G, 'vegan', 121, ['lasagnelevy', 'lasagnelevyt', 'lasagne-levy', 'lasagnepasta', 'lasagne'], { pieceGrams: 18, unitGrams: { levy: 18, pkt: 500 }, fineliConfidence: 0.95 }),
  ing('fresh-pasta', 'Tuorepasta', 'Fresh pasta', D, 'vegetarian', 31256, ['tuorepasta', 'tortelloni', 'tortellini', 'juustotortelloni', 'ravioli', 'tuore pasta', 'täytetty pasta', 'tuoretagliatelle', 'tuorespagetti', 'gnocchi', 'perunagnocchi'], { unitGrams: { pkt: 250, ps: 250 }, fineliConfidence: 0.85 }),
  ing('noodle', 'Nuudeli', 'Noodles', G, 'vegan', 120, ['nuudeli', 'vehnänuudeli', 'munanuudeli', 'ramen', 'ramennuudeli', 'udon', 'soba', 'pikanuudeli', 'wokkinuudeli'], { unitGrams: { pkt: 250, ps: 250 } }),
  ing('rice-noodle', 'Riisinuudeli', 'Rice noodles', G, 'vegan', 29055, ['riisinuudeli', 'lasinuudeli', 'riisinauha']),
  ing('rice', 'Riisi', 'Rice', G, 'vegan', 11521, ['riisi', 'pitkäjyväinen riisi', 'jasmiiniriisi', 'basmatiriisi', 'parboiled riisi', 'kiinteä riisi', 'thairiisi', 'villiriisi', 'riisiseos'], { unitGrams: { ps: 1000, pkt: 1000 } }),
  ing('cooked-rice', 'Keitetty riisi', 'Cooked rice', G, 'vegan', 1370, ['keitetty riisi', 'kypsä riisi', 'kypsennetty riisi', 'jäähtynyt riisi']),
  ing('porridge-rice', 'Puuroriisi', 'Short-grain rice', G, 'vegan', 156, ['puuroriisi', 'pyöreäjyväinen riisi', 'risottoriisi', 'arborio', 'arborioriisi', 'sushiriisi', 'carnaroli'], { fineliConfidence: 0.95 }),
  ing('brown-rice', 'Täysjyväriisi', 'Brown rice', G, 'vegan', 158, ['täysjyväriisi', 'tumma riisi', 'ruskea riisi']),
  ing('couscous', 'Kuskus', 'Couscous', G, 'vegan', 29208, ['kuskus', 'couscous', 'täysjyväkuskus']),
  ing('quinoa', 'Kvinoa', 'Quinoa', G, 'vegan', 31175, ['kvinoa', 'quinoa']),
  ing('bulgur', 'Bulgur', 'Bulgur', G, 'vegan', 175, ['bulgur', 'bulgurvehnä', 'vehnärouhe', 'bulguri'], { fineliConfidence: 0.85 }),
  ing('oats', 'Kaurahiutale', 'Rolled oats', G, 'vegan', 153, ['kaurahiutale', 'kaurahiutaleet', 'puurohiutale', 'kaurahiutale gluteeniton', 'täysjyväkaurahiutale', 'kaurahiude', 'hiutale'], { unitGrams: { ps: 1000, pkt: 1000 } }),
  ing('mixed-flakes', 'Neljän viljan hiutale', 'Four-grain flakes', G, 'vegan', 11005, ['neljän viljan hiutale', 'neljänviljanhiutale', 'viljahiutale', 'moniviljahiutale']),
  ing('oat-bran', 'Kauraleseet', 'Oat bran', G, 'vegan', 34971, ['kauraleseet', 'kauralese', 'kaurakuitunen', 'kaurarouhe']),
  ing('barley', 'Ohrasuurimo', 'Pearl barley', G, 'vegan', 151, ['ohrasuurimo', 'ohraryyni', 'helmiohra', 'ohra']),
  ing('buckwheat', 'Tattari', 'Buckwheat', G, 'vegan', 161, ['tattari', 'tattarisuurimo', 'tattarijauho']),
  ing('semolina', 'Mannasuurimo', 'Semolina', G, 'vegan', 112, ['mannasuurimo', 'manna', 'mannaryyni']),
  ing('wheat-flour', 'Vehnäjauho', 'Wheat flour', G, 'vegan', 110, ['vehnäjauho', 'jauho', 'puolikarkea vehnäjauho', 'erikoisvehnäjauho', 'hiivaleipäjauho', 'leivontavehnäjauho', 'vehnäjauhot', 'jauhot', 'puustijauho', 'pizzajauho', 'durumvehnäjauho'], { unitGrams: { pkt: 2000, ps: 2000 } }),
  ing('graham-flour', 'Grahamjauho', 'Graham flour', G, 'vegan', 111, ['grahamjauho', 'täysjyvävehnäjauho', 'spelttijauho', 'täysjyväspelttijauho']),
  ing('rye-flour', 'Ruisjauho', 'Rye flour', G, 'vegan', 100, ['ruisjauho', 'täysjyväruisjauho', 'ruissihtijauho', 'kokojyväruisjauho']),
  ing('bread-flour-mix', 'Sämpyläjauho', 'Bread flour mix', G, 'vegan', 125, ['sämpyläjauho', 'leipäjauhoseos', 'jauhoseos']),
  ing('corn-starch', 'Maissitärkkelys', 'Corn starch', G, 'vegan', 27, ['maissitärkkelys', 'maizena', 'maissijauho', 'maizena suuruste', 'suuruste', 'maissitärkkelysjauho']),
  ing('potato-starch', 'Perunajauho', 'Potato starch', G, 'vegan', 162, ['perunajauho', 'perunatärkkelys', 'perunasuurimo']),
  ing('sugar', 'Sokeri', 'Sugar', G, 'vegan', 1, ['sokeri', 'hienosokeri', 'taloussokeri', 'kidesokeri', 'fariinisokeri', 'ruskea sokeri', 'tomusokeri', 'raesokeri', 'muscovadosokeri', 'ruokosokeri', 'intiaaninsokeri', 'kookossokeri', 'hillosokeri'], { unitGrams: { pkt: 1000, ps: 1000 } }),
  ing('syrup', 'Siirappi', 'Syrup', G, 'vegan', 3, ['siirappi', 'tumma siirappi', 'vaalea siirappi', 'kultasiirappi', 'vaahterasiirappi', 'agavesiirappi', 'agavesiirappia', 'taatelisiirappi']),
  ing('honey', 'Hunaja', 'Honey', G, 'vegetarian', 4, ['hunaja', 'juokseva hunaja', 'kukkahunaja']),
  ing('vanilla-sugar', 'Vaniljasokeri', 'Vanilla sugar', G, 'vegan', 11188, ['vaniljasokeri', 'vanilliinisokeri', 'vanilja', 'vaniljatanko', 'vaniljauute', 'vaniljajauhe', 'vaniljanpalko'], SPICE),
  ing('baking-powder', 'Leivinjauhe', 'Baking powder', G, 'vegan', 74, ['leivinjauhe'], SPICE),
  ing('baking-soda', 'Ruokasooda', 'Baking soda', G, 'vegan', 31160, ['ruokasooda', 'sooda', 'natriumbikarbonaatti'], SPICE),
  ing('yeast', 'Hiiva', 'Yeast', D, 'vegan', 26, ['hiiva', 'tuorehiiva', 'kuivahiiva', 'leivinhiiva', 'pikahiiva'], { unitGrams: { pala: 50, pkt: 50, ps: 11 }, pieceGrams: 50, scaling: 'sublinear' }),
  ing('cocoa', 'Kaakaojauhe', 'Cocoa powder', G, 'vegan', 20, ['kaakaojauhe', 'kaakao', 'tumma kaakaojauhe', 'leivontakaakao']),
  ing('dark-chocolate', 'Tumma suklaa', 'Dark chocolate', G, 'vegan', 32, ['tumma suklaa', 'tumma leivontasuklaa', 'taloussuklaa', 'leivontasuklaa', 'suklaa', 'suklaarouhe', 'suklaanappi', 'suklaalastu', 'tumma suklaarouhe', 'tummasuklaa'], { unitGrams: { levy: 200, pkt: 200 }, fineliConfidence: 0.95 }),
  ing('milk-chocolate', 'Maitosuklaa', 'Milk chocolate', G, 'vegetarian', 33, ['maitosuklaa', 'maitosuklaarouhe'], { unitGrams: { levy: 200 } }),
  ing('white-chocolate', 'Valkosuklaa', 'White chocolate', G, 'vegetarian', 29156, ['valkosuklaa', 'valkoinen suklaa', 'valkosuklaarouhe'], { unitGrams: { levy: 150 } }),
  ing('gelatin', 'Liivate', 'Gelatin', G, 'meat', 25, ['liivate', 'liivatelehti', 'liivatejauhe', 'gelatiini'], { pieceGrams: 1.7, unitGrams: { levy: 1.7, oksa: 1.7 }, shoppingUnit: 'count' }),
  ing('almond', 'Manteli', 'Almonds', G, 'vegan', 379, ['manteli', 'mantelilastu', 'mantelirouhe', 'mantelijauho', 'kuorittu manteli', 'mantelijauhe', 'mantelirae']),
  ing('cashew', 'Cashewpähkinä', 'Cashew nuts', G, 'vegan', 11086, ['cashewpähkinä', 'cashew', 'cashewpähkinärouhe']),
  ing('peanut', 'Maapähkinä', 'Peanuts', G, 'vegan', 378, ['maapähkinä', 'suolapähkinä', 'maapähkinärouhe', 'paahdettu maapähkinä']),
  ing('walnut', 'Saksanpähkinä', 'Walnuts', G, 'vegan', 376, ['saksanpähkinä', 'saksanpähkinärouhe', 'pekaanipähkinä', 'pekaani']),
  ing('hazelnut', 'Hasselpähkinä', 'Hazelnuts', G, 'vegan', 375, ['hasselpähkinä', 'hasselpähkinärouhe', 'pähkinärouhe', 'pähkinä', 'pähkinäsekoitus']),
  ing('pine-nut', 'Pinjansiemen', 'Pine nuts', G, 'vegan', 30968, ['pinjansiemen', 'pinjansiemenet', 'pinjaseesam']),
  ing('sunflower-seed', 'Auringonkukansiemen', 'Sunflower seeds', G, 'vegan', 11212, ['auringonkukansiemen', 'auringonkukansiemenet', 'siemensekoitus', 'siemen']),
  ing('pumpkin-seed', 'Kurpitsansiemen', 'Pumpkin seeds', G, 'vegan', 31211, ['kurpitsansiemen', 'kurpitsansiemenet']),
  ing('sesame', 'Seesaminsiemen', 'Sesame seeds', G, 'vegan', 34245, ['seesaminsiemen', 'seesami', 'seesaminsiemenet', 'mustaseesami']),
  ing('flaxseed', 'Pellavansiemen', 'Flaxseed', G, 'vegan', 30991, ['pellavansiemen', 'pellavarouhe', 'pellavansiemenrouhe', 'chiansiemen', 'chia', 'chiasiemen'], { fineliConfidence: 0.9 }),
  ing('coconut-flakes', 'Kookoshiutale', 'Desiccated coconut', G, 'vegan', 382, ['kookoshiutale', 'kookosrouhe', 'kookoslastu']),
  ing('peanut-butter', 'Maapähkinävoi', 'Peanut butter', G, 'vegan', 378, ['maapähkinävoi', 'maapähkinätahna', 'pähkinävoi', 'mantelivoi', 'cashewvoi'], { fineliConfidence: 0.85, approximationNote: 'Arvioitu maapähkinän ravintoarvoilla.' }),
  ing('tahini', 'Tahini', 'Tahini', G, 'vegan', 11087, ['tahini', 'seesamitahna']),
  ing('red-lentil', 'Punainen linssi', 'Red lentils', G, 'vegan', 31219, ['punainen linssi', 'punaiset linssit', 'linssi', 'linssit', 'kuivattu linssi', 'keltainen linssi'], { unitGrams: { pkt: 500, ps: 500 } }),
  ing('green-lentil', 'Vihreä linssi', 'Green lentils', G, 'vegan', 399, ['vihreä linssi', 'ruskea linssi', 'musta linssi', 'belugalinssi', 'puy-linssi'], { unitGrams: { pkt: 500 } }),
  ing('chickpea', 'Kikherne', 'Chickpeas', C, 'vegan', 11089, ['kikherne', 'kikherneet', 'kikhernesäilyke', 'keitetty kikherne', 'kikhernekeitos'], { unitGrams: { tlk: 240, prk: 240, pkt: 240 } }),
  ing('kidney-bean', 'Kidneypapu', 'Kidney beans', C, 'vegan', 31214, ['kidneypapu', 'punainen papu', 'kidney-papu', 'punainen kidneypapu', 'pavut chilikastikkeessa'], { unitGrams: { tlk: 230, prk: 230, pkt: 230 } }),
  ing('white-bean', 'Valkoinen papu', 'White beans', C, 'vegan', 395, ['valkoinen papu', 'valkoiset pavut', 'cannellinipapu', 'voipapu', 'borlottipapu', 'papu', 'pavut', 'papusekoitus'], { unitGrams: { tlk: 240, prk: 240 }, fineliConfidence: 0.9 }),
  ing('black-bean', 'Musta papu', 'Black beans', C, 'vegan', 373, ['musta papu', 'mustapapu', 'mustat pavut'], { unitGrams: { tlk: 240 }, fineliConfidence: 0.8, approximationNote: 'Arvioitu kuivattujen papujen keskiarvolla.' }),
  ing('baked-beans', 'Tomaattikastikkeessa papu', 'Baked beans', C, 'vegan', 11090, ['papu tomaattikastikkeessa', 'uunipapu', 'baked beans', 'pavut tomaattikastikkeessa'], { unitGrams: { tlk: 420 } }),
  ing('fava-bean', 'Härkäpapu', 'Fava beans', G, 'vegan', 34743, ['härkäpapu', 'kuivattu härkäpapu', 'härkäpapujauho', 'härkäpapurouhe kuivattu']),
  ing('plant-mince', 'Kasviproteiinirouhe', 'Plant-based mince', D, 'vegan', 34893, ['kasviproteiinirouhe', 'härkis', 'kasvisrouhe', 'rouhe', 'kasvipohjainen rouhe', 'vegaaninen rouhe', 'kasvisjauheliha', 'härkäpapu-herne rouhe', 'härkäpapu-hernerouhe', 'rouhe härkäpapu', 'härkäpapurouhe', 'härkäpapuvalmiste', 'kasviproteiinikastike', 'kaurarouhe', 'kasviproteiini'], { fineliConfidence: 0.8, unitGrams: { pkt: 250, rs: 250 }, density: 0.5, approximationNote: 'Arvioitu härkäpapuvalmisteen ravintoarvoilla.', productNames: ['härkis'] }),
  ing('soy-mince', 'Soijarouhe', 'Soy mince', G, 'vegan', 33499, ['soijarouhe', 'soijasuikale', 'soijapala', 'soijarae', 'soijagranulaatti'], { density: 0.35 }),
  ing('pulled-oats', 'Nyhtökaura', 'Pulled oats', D, 'vegan', 34909, ['nyhtökaura', 'nyhtis', 'maustettu nyhtökaura'], { unitGrams: { pkt: 250, rs: 250 }, productNames: ['pulled oats'] }),
  ing('quorn', 'Quorn', 'Mycoprotein', F, 'vegetarian', 33925, ['quorn', 'quorn-suikale', 'mykoproteiini', 'quornfilee']),
  ing('tofu', 'Tofu', 'Tofu', D, 'vegan', 33501, ['tofu', 'maustettu tofu', 'savutofu', 'silkkitofu', 'kiinteä tofu', 'marinoitu tofu'], { unitGrams: { pkt: 250, rs: 250 } }),

  // --- Canned & jarred ---------------------------------------------------------------------
  ing('crushed-tomato', 'Tomaattimurska', 'Crushed tomatoes', C, 'vegan', 398, ['tomaattimurska', 'tomaattisäilyke', 'paseerattu tomaatti', 'tomaattipassata', 'passata', 'kuorittu tomaatti', 'säilyketomaatti', 'tomaattimurske', 'tomaattimurska yrtit', 'tomaattimurska valkosipuli', 'kokonainen kuorittu tomaatti', 'tomaattikastike murska', 'kirsikkatomaattisäilyke'], { unitGrams: { tlk: 400, pkt: 390, prk: 400 } }),
  ing('tomato-paste', 'Tomaattipyree', 'Tomato paste', C, 'vegan', 354, ['tomaattipyree', 'tomaattisose', 'tomaattitahna', 'tomaattikonsentraatti'], { unitGrams: { prk: 70, pkt: 70, tlk: 70 } }),
  ing('sundried-tomato', 'Aurinkokuivattu tomaatti', 'Sun-dried tomatoes', C, 'vegan', 30444, ['aurinkokuivattu tomaatti', 'aurinkokuivatut tomaatit', 'kuivattu tomaatti', 'aurinkotomaatti'], { unitGrams: { prk: 145, tlk: 145 } }),
  ing('olive', 'Oliivi', 'Olives', C, 'vegan', 28938, ['oliivi', 'oliivit', 'kalamata-oliivi', 'kalamataoliivi', 'musta oliivi', 'vihreä oliivi', 'kivetön oliivi', 'oliivirengas'], { unitGrams: { prk: 150, tlk: 150 }, pieceGrams: 4 }),
  ing('coconut-milk', 'Kookosmaito', 'Coconut milk', C, 'vegan', 29014, ['kookosmaito', 'kookoskerma', 'kookosjuoma', 'kevyt kookosmaito', 'kookosmaitojuoma'], { unitGrams: { tlk: 400, prk: 400 }, shoppingUnit: 'volume' }),
  ing('tomato-sauce', 'Tomaattikastike', 'Tomato sauce', C, 'vegan', 30728, ['tomaattikastike', 'pastakastike', 'pizzakastike', 'spagettikastike', 'bolognesekastike', 'pastasose', 'arrabbiatakastike'], { unitGrams: { prk: 400, tlk: 400 }, fineliConfidence: 0.9 }),
  ing('salsa', 'Salsakastike', 'Salsa', S, 'vegan', 30728, ['salsa', 'salsakastike', 'tacokastike', 'tacosalsa', 'taco sauce', 'chunky salsa'], { unitGrams: { prk: 230, pll: 230 }, fineliConfidence: 0.75, approximationNote: 'Arvioitu tomaattikastikkeen ravintoarvoilla.' }),

  // --- Spices, sauces, oils ----------------------------------------------------------------
  ing('salt', 'Suola', 'Salt', S, 'vegan', 30, ['suola', 'ruokasuola', 'merisuola', 'hiutalesuola', 'sormisuola', 'vuorisuola', 'karkea merisuola', 'jodioitu suola', 'mineraalisuola', 'himalajansuola', 'suolahiutale'], SPICE),
  ing('herb-salt', 'Yrttisuola', 'Herb salt', S, 'vegan', 11196, ['yrttisuola', 'aromisuola', 'sellerisuola', 'valkosipulisuola'], SPICE),
  ing('black-pepper', 'Mustapippuri', 'Black pepper', S, 'vegan', 11177, ['mustapippuri', 'pippuri', 'mustapippurirouhe', 'rouhittu mustapippuri', 'mustapippurirouhetta', 'kokonainen mustapippuri', 'pippurirouhe', 'mustapippurirouhe'], SPICE),
  ing('white-pepper', 'Valkopippuri', 'White pepper', S, 'vegan', 11178, ['valkopippuri', 'valkopippurirouhe'], SPICE),
  ing('allspice', 'Maustepippuri', 'Allspice', S, 'vegan', 11177, ['maustepippuri', 'maustepippurirouhe', 'jauhettu maustepippuri', 'sitruunapippuri', 'rosépippuri', 'viherpippuri'], { ...SPICE, fineliConfidence: 0.7 }),
  ing('paprika-powder', 'Paprikajauhe', 'Paprika powder', S, 'vegan', 11182, ['paprikajauhe', 'savupaprikajauhe', 'savupaprika', 'makea paprikajauhe', 'paprikamauste', 'jauhettu paprika'], SPICE),
  ing('chili-powder', 'Chilijauhe', 'Chili powder', S, 'vegan', 11182, ['chilijauhe', 'chilirouhe', 'cayennepippuri', 'cayenne', 'chilihiutale', 'chilimauste', 'jauhettu chili', 'kuivattu chili', 'chiliflakes'], { ...SPICE, fineliConfidence: 0.8, approximationNote: 'Arvioitu paprikajauheen ravintoarvoilla.' }),
  ing('cinnamon', 'Kaneli', 'Cinnamon', S, 'vegan', 11184, ['kaneli', 'jauhettu kaneli', 'kanelitanko', 'kanelijauhe'], SPICE),
  ing('cardamom', 'Kardemumma', 'Cardamom', S, 'vegan', 11187, ['kardemumma', 'jauhettu kardemumma', 'kardemummansiemen', 'kardemummakota'], SPICE),
  ing('clove', 'Neilikka', 'Clove', S, 'vegan', 11185, ['neilikka', 'mausteneilikka', 'jauhettu neilikka'], SPICE),
  ing('ground-ginger', 'Jauhettu inkivääri', 'Ground ginger', S, 'vegan', 11186, ['jauhettu inkivääri', 'inkiväärijauhe', 'kuivattu inkivääri'], SPICE),
  ing('oregano', 'Oregano', 'Oregano', S, 'vegan', 11191, ['oregano', 'kuivattu oregano', 'meirami', 'kuivattu meirami'], SPICE),
  ing('thyme', 'Timjami', 'Thyme', S, 'vegan', 11194, ['timjami', 'kuivattu timjami', 'tuore timjami', 'timjaminoksa', 'rosmariini', 'tuore rosmariini', 'rosmariininoksa', 'kuivattu rosmariini', 'salvia', 'tuore salvia'], { ...SPICE, fineliConfidence: 0.9 }),
  ing('dried-basil', 'Kuivattu basilika', 'Dried basil', S, 'vegan', 33433, ['kuivattu basilika', 'basilikamauste'], SPICE),
  ing('herb-mix', 'Yrttiseos', 'Dried herb mix', S, 'vegan', 11191, ['yrttiseos', 'yrttimauste', 'provencen yrtit', 'provencelainen yrttiseos', 'italialainen yrttiseos', 'pizzamauste', 'yrttimausteseos', 'kuivattu yrtti', 'kuivattu yrttiseos', 'yrtti', 'yrtit', 'välimerellinen yrttiseos', 'kuivattu persilja', 'kuivattu tilli', 'tillimauste', 'persiljamauste'], { ...SPICE, fineliConfidence: 0.7, approximationNote: 'Arvioitu kuivatun oreganon ravintoarvoilla.' }),
  ing('cumin', 'Juustokumina', 'Cumin', S, 'vegan', 11182, ['juustokumina', 'jauhettu juustokumina', 'kumina', 'kuminansiemen', 'roomankumina', 'jeera'], { ...APPROX_SPICE, supplementary: 'usda:2014' }),
  ing('turmeric', 'Kurkuma', 'Turmeric', S, 'vegan', 11182, ['kurkuma', 'kurkumajauhe', 'jauhettu kurkuma'], { ...APPROX_SPICE, supplementary: 'usda:2043' }),
  ing('curry-powder', 'Curry', 'Curry powder', S, 'vegan', 11182, ['curry', 'currymauste', 'currijauhe', 'curryjauhe', 'garam masala', 'garam masala -mausteseos', 'tandoorimauste', 'tikka masala -mausteseos', 'intialainen mausteseos', 'currymausteseos'], { ...APPROX_SPICE, supplementary: 'usda:2015', supplementaryConfidence: 0.8 }),
  ing('coriander-seed', 'Korianterinsiemen', 'Coriander seed', S, 'vegan', 11182, ['korianterinsiemen', 'jauhettu korianteri', 'korianterinsiemenet', 'jauhettu korianterinsiemen'], { ...APPROX_SPICE, supplementary: 'usda:2013' }),
  ing('nutmeg', 'Muskottipähkinä', 'Nutmeg', S, 'vegan', 11182, ['muskottipähkinä', 'muskotti', 'jauhettu muskottipähkinä', 'muskottikukka'], { ...APPROX_SPICE, supplementary: 'usda:2025' }),
  ing('bay-leaf', 'Laakerinlehti', 'Bay leaf', S, 'vegan', 11182, ['laakerinlehti', 'laakerinlehdet'], { ...APPROX_SPICE, supplementary: 'usda:2004', pieceGrams: 0.2, unitGrams: { oksa: 0.2 } }),
  ing('taco-seasoning', 'Tacomauste', 'Taco seasoning', S, 'vegan', 11182, ['tacomauste', 'taco seasoning', 'tacomausteseos', 'taco-mauste', 'taco-mausteseos', 'fajitamauste', 'fajitamausteseos', 'burritomauste', 'chilimausteseos', 'texmex-mauste', 'mausteseos taco'], { ...APPROX_SPICE, fineliConfidence: 0.6, unitGrams: { pkt: 25, ps: 25 }, approximationNote: 'Fineli ei sisällä tacomaustetta; arvioitu paprikajauheen mukaan.' }),
  ing('spice-mix', 'Mausteseos', 'Spice mix', S, 'vegan', 11182, ['mausteseos', 'grillimauste', 'kanamauste', 'broilermauste', 'lihamauste', 'kalamauste', 'cajunmauste', 'cajun', 'jerk-mauste', 'ras el hanout', 'za\'atar', 'dukkah', 'mauste', 'maustesekoitus', 'kebabmauste', 'gyrosmauste', 'kasvismauste', 'pippurisekoitus'], { ...APPROX_SPICE, unitGrams: { pkt: 25, ps: 25 } }),
  ing('onion-powder', 'Sipulijauhe', 'Onion powder', S, 'vegan', 336, ['sipulijauhe', 'kuivattu sipuli', 'sipulirouhe', 'paahdettu sipuli', 'paistettu sipuli', 'rapea sipuli'], { ...SPICE, fineliConfidence: 0.85 }),
  ing('garlic-powder', 'Valkosipulijauhe', 'Garlic powder', S, 'vegan', 336, ['valkosipulijauhe', 'valkosipulirouhe', 'kuivattu valkosipuli', 'valkosipulimauste'], { ...SPICE, fineliConfidence: 0.6, approximationNote: 'Arvioitu kuivatun sipulin ravintoarvoilla.', supplementary: 'usda:2020' }),
  ing('vegetable-stock', 'Kasvisliemi', 'Vegetable stock', S, 'vegan', 29026, ['kasvisliemi', 'kasvisfondi liemi', 'valmis kasvisliemi', 'liemi'], { shoppingUnit: 'volume', fineliConfidence: 0.95 }),
  ing('vegetable-stock-cube', 'Kasvisliemikuutio', 'Vegetable stock cube', S, 'vegan', 29008, ['kasvisliemikuutio', 'kasvisliemijauhe', 'kasvisfondi', 'liemikuutio', 'kasvisliemitiiviste', 'liemijauhe', 'kasvisbuljonki', 'buljonki', 'buljonkikuutio', 'yrttiliemikuutio', 'sieniliemikuutio'], { ...SPICE, pieceGrams: 11, unitGrams: { pala: 11 } }),
  ing('chicken-stock', 'Kanaliemi', 'Chicken stock', S, 'meat', 30315, ['kanaliemi', 'broileriliemi', 'kanafondi liemi', 'valmis kanaliemi'], { shoppingUnit: 'volume' }),
  ing('chicken-stock-cube', 'Kanaliemikuutio', 'Chicken stock cube', S, 'meat', 29009, ['kanaliemikuutio', 'kanaliemijauhe', 'kanafondi', 'broileriliemikuutio', 'kanaliemitiiviste', 'kanabuljonki'], { ...SPICE, pieceGrams: 11, unitGrams: { pala: 11 } }),
  ing('beef-stock', 'Lihaliemi', 'Beef stock', S, 'meat', 29, ['lihaliemi', 'naudanliemi', 'valmis lihaliemi', 'luuliemi'], { shoppingUnit: 'volume' }),
  ing('beef-stock-cube', 'Lihaliemikuutio', 'Beef stock cube', S, 'meat', 38, ['lihaliemikuutio', 'lihaliemijauhe', 'lihafondi', 'naudanfondi', 'lihaliemitiiviste', 'vasikanfondi', 'riistafondi', 'fondi'], { ...SPICE, pieceGrams: 11, unitGrams: { pala: 11 } }),
  ing('fish-stock', 'Kalaliemi', 'Fish stock', S, 'fish', 75, ['kalaliemi', 'valmis kalaliemi'], { shoppingUnit: 'volume' }),
  ing('fish-stock-cube', 'Kalaliemikuutio', 'Fish stock cube', S, 'fish', 29010, ['kalaliemikuutio', 'kalafondi', 'kalaliemijauhe', 'kalaliemitiiviste', 'äyriäisfondi'], { ...SPICE, pieceGrams: 11 }),
  ing('soy-sauce', 'Soijakastike', 'Soy sauce', S, 'vegan', 31, ['soijakastike', 'soija', 'japanilainen soija', 'kiinalainen soija', 'tumma soija', 'vaalea soija', 'tamari', 'makea soijakastike', 'ketjap manis', 'teriyakikastike', 'osterikastike', 'kalakastike'], { fineliConfidence: 0.95 }),
  ing('ketchup', 'Ketsuppi', 'Ketchup', S, 'vegan', 353, ['ketsuppi', 'tomaattiketsuppi', 'grillikastike', 'bbq-kastike', 'barbecuekastike'], { fineliConfidence: 0.95 }),
  ing('mustard', 'Sinappi', 'Mustard', S, 'vegan', 28, ['sinappi', 'dijonsinappi', 'dijon', 'karkea sinappi', 'kokojyväsinappi', 'makea sinappi', 'väkevä sinappi', 'sinapinsiemen', 'täysjyväsinappi']),
  ing('mayonnaise', 'Majoneesi', 'Mayonnaise', S, 'vegetarian', 30925, ['majoneesi', 'aioli', 'majo', 'kevytmajoneesi', 'valkosipulimajoneesi', 'chilimajoneesi', 'sriracha-majoneesi'], { fineliConfidence: 0.9 }),
  ing('vinegar', 'Etikka', 'Vinegar', S, 'vegan', 933, ['etikka', 'väkiviinaetikka', 'talousetikka', 'etikkaliemi'], { scaling: 'sublinear' }),
  ing('wine-vinegar', 'Viinietikka', 'Wine vinegar', S, 'vegan', 929, ['viinietikka', 'punaviinietikka', 'valkoviinietikka', 'balsamietikka', 'balsamico', 'omenaviinietikka', 'riisiviinietikka', 'sherryetikka', 'balsamiviinietikka'], { fineliConfidence: 0.85 }),
  ing('sweet-chili-sauce', 'Makea chilikastike', 'Sweet chili sauce', S, 'vegan', 33020, ['makea chilikastike', 'sweet chili', 'sweet chili -kastike', 'chilikastike', 'srirachakastike', 'sriracha', 'tabasco', 'sambal oelek'], { fineliConfidence: 0.85 }),
  ing('curry-paste', 'Currytahna', 'Curry paste', S, 'vegan', 33021, ['currytahna', 'punainen currytahna', 'vihreä currytahna', 'keltainen currytahna', 'massaman currytahna', 'tikka masala -tahna', 'currypasta', 'harissa', 'harissatahna', 'chilitahna', 'misotahna', 'miso'], { fineliConfidence: 0.85, unitGrams: { prk: 110, tlk: 110 } }),
  ing('pesto', 'Pesto', 'Pesto', S, 'vegetarian', 3323, ['pesto', 'basilikapesto', 'vihreä pesto', 'pestokastike', 'yrttipesto'], { unitGrams: { prk: 190, tlk: 190 } }),
  ing('red-pesto', 'Punainen pesto', 'Red pesto', S, 'vegan', 33112, ['punainen pesto', 'tomaattipesto', 'aurinkokuivattu tomaattipesto'], { unitGrams: { prk: 190 } }),
  ing('hummus', 'Hummus', 'Hummus', D, 'vegan', 34666, ['hummus', 'hummustahna', 'kikhernetahna'], { unitGrams: { prk: 250, rs: 250 } }),
  ing('jam', 'Hillo', 'Jam', G, 'vegan', 450, ['hillo', 'marjahillo', 'mansikkahillo', 'vadelmahillo', 'mustikkahillo', 'puolukkahillo', 'survos', 'marmeladi', 'aprikoosihillo', 'kirsikkahillo', 'karpalohillo'], { fineliConfidence: 0.9 }),
  ing('rapeseed-oil', 'Rypsiöljy', 'Rapeseed oil', S, 'vegan', 535, ['rypsiöljy', 'öljy', 'ruokaöljy', 'kasviöljy', 'paistoöljy', 'neutraali öljy', 'rapsiöljy', 'friteerausöljy', 'kylmäpuristettu rypsiöljy', 'maissiöljy'], { shoppingUnit: 'volume', scaling: 'sublinear' }),
  ing('olive-oil', 'Oliiviöljy', 'Olive oil', S, 'vegan', 536, ['oliiviöljy', 'extra virgin oliiviöljy', 'neitsytoliiviöljy', 'ekstra-neitsytoliiviöljy', 'extra virgin -oliiviöljy', 'oliiviöljy extra virgin'], { shoppingUnit: 'volume', scaling: 'sublinear' }),
  ing('sunflower-oil', 'Auringonkukkaöljy', 'Sunflower oil', S, 'vegan', 540, ['auringonkukkaöljy']),
  ing('sesame-oil', 'Seesamiöljy', 'Sesame oil', S, 'vegan', 541, ['seesamiöljy', 'paahdettu seesamiöljy', 'chiliöljy', 'pähkinäöljy', 'avokadoöljy'], { fineliConfidence: 0.85, approximationNote: 'Arvioitu ruokaöljyn keskiarvolla.' }),
  ing('coconut-oil', 'Kookosöljy', 'Coconut oil', S, 'vegan', 34140, ['kookosöljy', 'kookosrasva', 'neitsytkookosöljy']),
  ing('water', 'Vesi', 'Water', O, 'vegan', 922, ['vesi', 'kylmä vesi', 'kiehuva vesi', 'haalea vesi', 'lämmin vesi', 'kuuma vesi', 'jäävesi', 'vesijohtovesi', 'keitinvesi', 'pastan keitinvesi'], { excludeFromShopping: true }),
  ing('white-wine', 'Valkoviini', 'White wine', O, 'vegan', 925, ['valkoviini', 'kuiva valkoviini', 'kuohuviini', 'sherry', 'marsala'], { shoppingUnit: 'volume' }),
  ing('red-wine', 'Punaviini', 'Red wine', O, 'vegan', 924, ['punaviini', 'kuiva punaviini', 'portviini'], { shoppingUnit: 'volume' }),
  ing('beer', 'Olut', 'Beer', O, 'vegan', 902, ['olut', 'tumma olut', 'vaalea olut', 'lager', 'porter', 'stout'], { shoppingUnit: 'volume' }),
  ing('french-fries', 'Ranskanperuna', 'French fries', F, 'vegan', 207, ['ranskanperuna', 'ranskalainen', 'ranskalaiset perunat', 'lohkoperuna', 'uuniranskalainen'], { unitGrams: { ps: 750, pkt: 750 } }),
  ing('mashed-potato-powder', 'Perunamuusijauhe', 'Instant mashed potato', G, 'vegan', 33601, ['perunamuusijauhe', 'perunasosejauhe', 'pikamuusi', 'muusijauhe', 'perunahiutale']),
  ing('orange-juice', 'Appelsiinimehu', 'Orange juice', O, 'vegan', 11045, ['appelsiinimehu', 'appelsiinituoremehu', 'täysmehu', 'tuoremehu', 'omenamehu'], { fineliConfidence: 0.7, shoppingUnit: 'volume', density: 1, approximationNote: 'Arvioitu appelsiinin ravintoarvoilla.' }),
]

// ---------------------------------------------------------------------------------------------

const byId = new Map(INGREDIENTS.map((i) => [i.id, i]))
const byFineli = new Map<number, CanonicalIngredient>()
for (const i of INGREDIENTS) {
  // First (most specific) entry wins for reverse lookups, but prefer full-confidence mappings.
  if (i.fineliId === null) continue
  const existing = byFineli.get(i.fineliId)
  if (!existing || (existing.fineliConfidence < 1 && i.fineliConfidence === 1)) byFineli.set(i.fineliId, i)
}

export function getIngredient(id: string | null | undefined): CanonicalIngredient | undefined {
  return id ? byId.get(id) : undefined
}

/** Canonical ingredient whose nutrition source is the given Fineli food (used for Fineli dish rows). */
export function ingredientForFineli(fineliId: number): CanonicalIngredient | undefined {
  return byFineli.get(fineliId)
}
