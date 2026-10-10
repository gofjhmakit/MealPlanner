/**
 * Lightweight Finnish text handling for ingredient names.
 *
 * Recipes write ingredients in inflected forms – mostly the partitive
 * ("kevytmaitoa", "sipulia", "tomaatteja") and genitive ("broilerin", "naudan").
 * Rather than a full morphological analyser, we generate a small set of
 * plausible base-form candidates for each word and look them up in the
 * ingredient dictionary. False candidates are harmless because they only
 * count when they hit a known alias.
 */

/** Brand and store names removed before matching (lower-case). */
export const BRAND_WORDS = [
  'valio', 'pirkka', 'rainbow', 'k-menu', 'kmenu', 'mutti', 'fazer', 'arla', 'atria', 'hk', 'snellman',
  'saarioinen', 'apetit', 'dansukker', 'meira', 'santa maria', 'santa-maria', 'gold&green', 'gold & green',
  'eldorado', 'x-tra', 'xtra', 'kotimaista', 'felix', 'blå band', 'knorr', 'unelma', 'oululainen', 'vaasan',
  'elovena', 'myllyn paras', 'oatly', 'alpro', 'provena', 'sunnuntai', 'keiju', 'flora', 'becel', 'oivariini',
  'kotimaista', 'kariniemen', 'rypsiporsas', 'kultaranta', 'eila', 'polar', 'koskenlaskija', 'oltermanni',
  'kerava', 'kespro', 'lidl', 'k-market', 'prisma', 'coop', 'pingviini', 'ingman', 'kulta katriina',
  'paulig', 'risenta', 'jalotofu', 'verso', 'härkis', 'pouttu', 'kivikylän', 'kokkikartano', 'bonne',
  'heinz', 'hellmann\'s', 'barilla', 'rummo', 'de cecco', 'panzani', 'dolmio', 'uncle ben\'s', 'poppamies',
  'maku', 'kokkikolmoset', 'hyvä nauta', 'tapola', 'lunden', 'lindström', 'president', 'galbani', 'castello',
  'aura', 'apetina', 'viola', 'philadelphia', 'creme bonjour', 'crème bonjour', 'cantadou', 'turunmaa',
]

/** Words that carry no identity for matching and are removed. */
const FILLER_WORDS = new Set([
  'esim', 'esim.', 'esimerkiksi', 'noin', 'n.', 'n', 'vähintään', 'enintään', 'reilu', 'reilut', 'vajaa', 'vajaat',
  'hyvää', 'hyvä', 'laadukasta', 'laadukas', 'haluamaasi', 'haluamaa', 'maun', 'mukaan', 'tarvittaessa',
  'valinnainen', 'halutessasi', 'koristeluun', 'koristeeksi', 'tarjoiluun', 'paistamiseen', 'voiteluun',
  'friteeraukseen', 'päälle', 'pinnalle', 'kotimaista', 'kotimainen', 'luomu', 'luomua', 'suomalainen',
  'suomalaista', '®', '™', 'tms', 'tms.', 'yms', 'yms.',
])

/** Modifiers that don't change what the ingredient fundamentally is. */
export const NEUTRAL_MODIFIERS = new Set([
  'tuore', 'tuoretta', 'tuoreita', 'tuoreena', 'pieni', 'pientä', 'pieniä', 'iso', 'isoa', 'isoja', 'suuri', 'suurta',
  'keskikokoinen', 'keskikokoista', 'keskikokoisia', 'kokonainen', 'kokonaista', 'kokonaisia', 'laktoositon',
  'laktoositonta', 'vähälaktoosinen', 'vähälaktoosista', 'vl', 'gluteeniton', 'gluteenitonta', 'kylmä', 'kylmää',
  'lämmin', 'lämmintä', 'haalea', 'haaleaa', 'huoneenlämpöinen', 'huoneenlämpöistä', 'kuorittu', 'kuorittua',
  'kuorittuja', 'pestyä', 'pesty', 'pestyjä', 'kypsä', 'kypsää', 'kypsiä', 'punainen', 'punaista', 'punaisia',
  'keltainen', 'keltaista', 'keltaisia', 'vihreä', 'vihreää', 'vihreitä', 'valkoinen', 'valkoista', 'tumma',
  'tummaa', 'vaalea', 'vaaleaa', 'hienonnettu', 'hienonnettua', 'raastettu', 'raastettua', 'jauhettu', 'jauhettua',
  'rouhittu', 'rouhittua', 'kuivattu', 'kuivattua', 'kuivattuja', 'pakastettu', 'pakastettua', 'pakastettuja',
  'maustamaton', 'maustamatonta', 'suolaton', 'suolatonta', 'murskattu', 'murskattua', 'pilkottu', 'pilkottua',
  'kuutioitu', 'kuutioitua', 'viipaloitu', 'viipaloitua', 'sulatettu', 'sulatettua', 'keitetty', 'keitettyä',
  'keitettyjä', 'kypsennetty', 'kypsennettyä', 'valutettu', 'valutettua', 'valutettuja',
])

/** Trailing preparation descriptions moved to the ingredient note. */
const PREP_PATTERN =
  /(?<![\p{L}])(hienonnettuna|hienoksi|raastettuna|murskattuna|jauhettuna|kuivattuna|rouhittuna|paloina|kuutioina|viipaleina|suikaleina|lohkoina|renkaina|siivuina|kuorittuna|valutettuna|sulatettuna|keitettynä|kypsennettynä|paistettuna|pilkottuna|puolitettuna|halkaistuna|revittynä|pakasteena|tuoreena|huoneenlämpöisenä|pehmeänä|sulana|kylmänä|lämpimänä|öljyssä|suolaliemessä|vedessä|omassa liemessään|liemessään|sokeriliemessä|mehussaan)(?![\p{L}])/giu

/** Irregular or gradation-changing inflections (suffix -> base). Applied to compound ends too. */
const IRREGULAR_SUFFIXES: [string, string][] = [
  ['kynttä', 'kynsi'], ['kynnet', 'kynsi'], ['kynsiä', 'kynsi'], ['kynnen', 'kynsi'],
  ['vettä', 'vesi'], ['veden', 'vesi'],
  ['lientä', 'liemi'], ['liemen', 'liemi'],
  ['naudan', 'nauta'], ['sian', 'sika'], ['lohta', 'lohi'], ['lohen', 'lohi'],
  ['siipeä', 'siipi'], ['siivet', 'siipi'], ['siipiä', 'siipi'], ['siiven', 'siipi'],
  ['koipea', 'koipi'], ['koivet', 'koipi'], ['koipia', 'koipi'], ['koiven', 'koipi'],
  ['reittä', 'reisi'], ['reidet', 'reisi'], ['reisiä', 'reisi'], ['reiden', 'reisi'],
  ['fileitä', 'filee'], ['fileet', 'filee'], ['filettä', 'file'],
  ['hernettä', 'herne'], ['herneet', 'herne'], ['herneen', 'herne'],
  ['lehteä', 'lehti'], ['lehdet', 'lehti'], ['lehtiä', 'lehti'],
  ['tomaatin', 'tomaatti'], ['kurkun', 'kurkku'], ['sipulin', 'sipuli'],
  ['juuren', 'juuri'], ['juurta', 'juuri'], ['juuria', 'juuri'],
  ['siemenet', 'siemen'], ['siemeniä', 'siemen'], ['siementä', 'siemen'],
  ['suurimoita', 'suurimo'], ['hiutaleita', 'hiutale'],
  ['munia', 'muna'], ['munaa', 'muna'], ['munat', 'muna'], ['munan', 'muna'],
  ['kermaa', 'kerma'], ['voita', 'voi'], ['voin', 'voi'],
  ['jauhoja', 'jauho'], ['jauhot', 'jauho'],
  ['pähkinöitä', 'pähkinä'], ['pähkinää', 'pähkinä'],
  ['mansikoita', 'mansikka'], ['perunoita', 'peruna'], ['porkkanoita', 'porkkana'], ['omenoita', 'omena'],
  ['paprikoita', 'paprika'], ['banaaneja', 'banaani'], ['sieniä', 'sieni'], ['sienet', 'sieni'],
]

/** Ordered suffix rules: [suffix, replacements]. Every matching rule contributes candidates. */
const SUFFIX_RULES: [string, string[]][] = [
  ['oita', ['a', 'o']], ['öitä', ['ä', 'ö']],
  ['oja', ['a', 'o']], ['öjä', ['ä', 'ö']],
  ['eita', ['e', 'i']], ['eitä', ['e', 'i']],
  ['eja', ['i', 'e']], ['ejä', ['i', 'e']],
  ['ita', ['', 'i', 'a']], ['itä', ['', 'i', 'ä']],
  ['ia', ['i', 'a', '']], ['iä', ['i', 'ä', '']],
  ['tta', ['']], ['ttä', ['']],
  ['ja', ['']], ['jä', ['']],
  ['ta', ['']], ['tä', ['']],
  ['a', ['']], ['ä', ['']],
  ['in', ['i']],
  ['en', ['e', 'i']],
  ['n', ['']],
  ['t', ['']],
]

const WEAK_TO_STRONG: [RegExp, string][] = [
  [/([aeiouyäö])t([aeiouyäö])$/u, '$1tt$2'],
  [/([aeiouyäö])k([aeiouyäö])$/u, '$1kk$2'],
  [/([aeiouyäö])p([aeiouyäö])$/u, '$1pp$2'],
]

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Lower-case, strip trademark signs, bracketed text and brand words. */
export function stripBrandsAndNoise(input: string): string {
  let s = input.toLowerCase().replace(/[®™©]/g, ' ')
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
  for (const re of brandPatterns()) s = s.replace(re, '$1 ')
  return normalizeWhitespace(s)
}

let brandRegexes: RegExp[] | null = null
function brandPatterns(): RegExp[] {
  if (!brandRegexes) {
    brandRegexes = BRAND_WORDS.map((brand) => {
      const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)
      return new RegExp(`(^|[\\s,/-])${escaped}(?=$|[\\s,/-])`, 'gu')
    })
  }
  return brandRegexes
}

export interface CleanedName {
  /** Name used for matching, e.g. "broilerin fileesuikaleita". */
  name: string
  /** Preparation notes removed from the name ("hienonnettuna", text after comma). */
  note: string | null
}

/**
 * Clean an ingredient name (the part of the line after quantity and unit).
 * "Valio kevytmaitoa" -> "kevytmaitoa"; "sipuli, hienonnettuna" -> name "sipuli", note "hienonnettuna".
 */
const COMPOUND_HEADS = ['öljy', 'jauho', 'juusto', 'liha', 'kerma', 'maito', 'sokeri', 'kastike', 'liemi', 'mauste', 'siemen', 'pähkinä', 'rouhe', 'hiutale', 'suurimo', 'mehu', 'etikka', 'viini', 'filee', 'file', 'leipä', 'riisi', 'pasta', 'papu', 'kaali', 'sipuli', 'salaatti', 'jogurtti', 'rahka']
/** Adjectives and participles ("isoja", "kuorittuja", "suolattomia", "tuoreita"), never an ingredient by themselves. */
const DESCRIBING_RE = /^(isoj?a|pieni(ä|tä)|tuoreit?a|kypsää|kypsiä|kylmää|kylmiä|lämmintä|kuumaa|\p{L}*[aeiouyäö](ttuj?a|ttyj?ä|nutta|nyttä|neita|neitä)|\p{L}*(ttomia|ttömiä|tonta|töntä))$/iu

export function cleanIngredientName(input: string): CleanedName {
  const notes: string[] = []
  let s = input
  // Text after the first comma is almost always a preparation note.
  const comma = s.indexOf(',')
  if (comma > 0) {
    notes.push(s.slice(comma + 1).trim())
    s = s.slice(0, comma)
  }
  // "esim. Mutti", "esimerkiksi X" -> drop the example part
  s = s.replace(/\b(esim\.?|esimerkiksi)\s.*$/iu, (m) => {
    notes.push(m.trim())
    return ''
  })
  s = s.replace(PREP_PATTERN, (m) => {
    notes.push(m.toLowerCase())
    return ' '
  })
  s = stripBrandsAndNoise(s)
  // "maapähkinä- tai rypsiöljyä": the first part shares the head of the second -> "maapähkinäöljyä"
  s = s.replace(/(\p{L}+)-\s+(tai|ja)\s+(\p{L}+)/u, (m, a: string, conj: string, b: string) => {
    const head = COMPOUND_HEADS.map((h) => ({ h, i: b.toLowerCase().lastIndexOf(h) })).filter((x) => x.i > 0).sort((x, y) => y.i - x.i)[0]
    return head ? `${a}${b.slice(head.i)} ${conj} ${b}` : m
  })
  // "rouhetta härkäpapu & herne" / "suolaa ja pippuria": the first alternative is the primary ingredient,
  // unless it is only describing words: "isoja kuorittuja ja suolettomia katkarapuja"
  const alt = s.search(/\s(&|tai|ja)\s/u)
  if (alt > 0 && !s.slice(0, alt).trim().split(/\s+/).every((w) => DESCRIBING_RE.test(w))) {
    const first = s.slice(0, alt).trim()
    const lastWord = s.slice(alt).trim().split(/\s+/).at(-1) ?? ''
    notes.push(s.slice(alt).trim())
    // "broilerin tai kalkkunan rintafileetä": a lone genitive shares the noun of the last alternative
    s = /^\p{L}+n$/u.test(first) && /\s\p{L}+n\s/u.test(` ${s.slice(alt).trim()} `) ? `${first} ${lastWord}` : first
  }
  const words = s
    .split(' ')
    .map((w) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d-]+$/gu, ''))
    .filter((w) => w && !FILLER_WORDS.has(w))
  const note = normalizeWhitespace(notes.filter(Boolean).join(', ')) || null
  return { name: words.join(' '), note }
}

/** Plausible base forms for one (possibly inflected) Finnish word. Always includes the word itself. */
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>([w])
  for (const [suffix, base] of IRREGULAR_SUFFIXES) {
    if (w.endsWith(suffix)) out.add(w.slice(0, w.length - suffix.length) + base)
  }
  if (w.length > 3) {
    for (const [suffix, replacements] of SUFFIX_RULES) {
      if (!w.endsWith(suffix) || w.length - suffix.length < 2) continue
      const stem = w.slice(0, w.length - suffix.length)
      for (const r of replacements) {
        const cand = stem + r
        if (cand.length >= 2) out.add(cand)
        for (const [re, rep] of WEAK_TO_STRONG) {
          if (re.test(cand)) out.add(cand.replace(re, rep))
        }
      }
    }
  }
  return [...out]
}

/**
 * Tokenize a cleaned name. Hyphenated compounds are split so that the last
 * part stays the head word ("juustotortelloni-tuorepastaa" -> [juustotortelloni, tuorepastaa]).
 */
export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s/&+-]+/)
    .filter((t) => t && t !== 'ja' && t !== 'tai')
}

/** Base forms of a whole (multi-word) name, used as dictionary keys for user mappings. */
export function normalizeKey(name: string): string {
  return tokenize(cleanIngredientName(name).name)
    .map((t) => {
      const c = lemmaCandidates(t)
      // Prefer the shortest candidate that is still at least 70% of the original length.
      return c.filter((x) => x.length >= Math.ceil(t.length * 0.7)).sort((a, b) => a.length - b.length)[0] ?? t
    })
    .join(' ')
}
