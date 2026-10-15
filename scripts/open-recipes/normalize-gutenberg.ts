/**
 * Historical public-domain cookbooks from Project Gutenberg → en/<source>.json, one record per recipe
 * with the original wording (no ingredient lists: old books write recipes as prose). The Finnish
 * catalogue version (fi/<source>/) adds a modern interpretation; the build keeps the original text.
 *
 *   node scripts/open-recipes/normalize-gutenberg.ts
 * Expects data/open-recipes/raw/gutenberg/pg73445.txt (Kokki-kirja, 1849), pg8102.txt (The Forme of Cury, c. 1390),
 * pg29728.txt (Apicius) and pg12815.txt (American Cookery, 1796).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../../data/open-recipes')
const raw = (n: number) => readFileSync(join(ROOT, 'raw/gutenberg', `pg${n}.txt`), 'utf8').replace(/\r/g, '')
const body = (t: string) => t.slice(t.indexOf('*** START OF'), t.indexOf('*** END OF'))
const paragraphs = (t: string) => t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/_([^_]+)_/g, '$1').trim()).filter(Boolean)

interface Historical {
  id: string
  source: string
  title: string
  section?: string
  ingredients: []
  tags: string[]
  instructions: string[]
  notes?: string[]
  sourceUrl: string
  author: string
  license: string
  year: number
}

// --- Kokki-kirja (Granlund, Turku 1849): "N:o 12. Title." headings inside "N:nen Jako." chapters ---
{
  const text = body(raw(73445))
  const lines = text.split('\n')
  const out: Historical[] = []
  let section = ''
  let current: { no: number; title: string; lines: string[] } | null = null
  const flush = () => {
    if (!current) return
    const paras = paragraphs(current.lines.join('\n'))
    out.push({
      id: `kokkikirja-${String(current.no).padStart(3, '0')}`,
      source: 'kokkikirja',
      title: current.title.replace(/\.$/, ''),
      section,
      ingredients: [],
      tags: [],
      instructions: paras,
      sourceUrl: 'https://www.gutenberg.org/ebooks/73445',
      author: 'J. F. Granlund (toim.)',
      license: 'Public domain',
      year: 1849,
    })
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const chapter = line.match(/^\d+:\w+ Jako\.$/)
    if (chapter) {
      flush()
      // the chapter name is the next non-empty line in capitals
      const name = lines.slice(i + 1).find((l) => l.trim())?.trim() ?? ''
      section = name.charAt(0) + name.slice(1).toLowerCase()
      continue
    }
    // A heading starts a paragraph; "N:o 47 neuvottuja kokkaroita" inside the text is a reference, not a heading.
    const head = !lines[i - 1]?.trim() ? line.match(/^N:o (\d+)\.? ([A-ZÄÖÅ].*)$/) : null
    if (head) {
      flush()
      // A heading can run over two lines ("N:o 381. Kuinka koit ja toukat saadaan häviämään aitoista ja / kellareista.")
      let title = head[2]
      let j = i + 1
      while (!/\.$/.test(title) && lines[j]?.trim()) title += ` ${lines[j++].trim()}`
      // Some headings carry the first sentence of the recipe after the title ("266. Panskan Torttua. N:o 258 neuvotusta…").
      const [t, ...rest] = title.split(/(?<=\.) (?=[A-ZÄÖN])/)
      current = { no: Number(head[1]), title: t, lines: rest.length ? [rest.join(' ')] : [] }
      i = j - 1
      continue
    }
    if (/^Reisteri\.?$/.test(line) && out.length + (current ? 1 : 0) > 0) {
      flush()
      break
    }
    current?.lines.push(lines[i])
  }
  flush()
  for (const [k, r] of out.entries()) {
    // A heading that is not at a paragraph start stays in the previous recipe ("… säilyvä N:o 256. Sianliha-Makkaroita. …"),
    // and sub-chapter headings ("B) TORTTUJA.", "RUOKIEN-NAUTINNON-JÄRJESTYS. …") trail the last paragraph.
    const next = out[k + 1] && Number(out[k + 1].id.split('-')[1])
    let text = r.instructions.join('\n\n')
    if (next) text = text.split(new RegExp(String.raw`\s*N:o ${next}\. `))[0]
    text = text.replace(/\s+(?:[A-E]\) )?[A-ZÄÖÅ][A-ZÄÖÅÉ'’ -]{3,}(?: \([A-ZÄÖÅÉ]+\))?\.(?:\s[\s\S]*)?$/, '')
    r.instructions = text.split('\n\n')
  }
  writeFileSync(join(ROOT, 'en/kokkikirja.json'), JSON.stringify(out, null, 1))
  console.log(`kokkikirja: ${out.length} recipes`)
}

// --- The Forme of Cury (c. 1390, ed. Pegge 1780): "UPPERCASE TITLE [n]. XX.II." headings, glosses as [n] notes ---
{
  const text = body(raw(8102))
  const start = text.indexOf('FOR TO MAKE GRONDEN BENES')
  const end = text.indexOf('INDEX', text.indexOf('EXPLICIT', start) > 0 ? text.indexOf('EXPLICIT', start) : start)
  // The same book also holds "Ancient Cookery" (1381) after the roll: stop there.
  const ancient = text.indexOf('ANCIENT COOKERY', start)
  const part = text.slice(start, ancient > start ? ancient : end > start ? end : undefined)
  // Headings: "FOR TO MAKE GRONDEN BENES [1]. I.", "HARES [1] IN TALBOTES [2]. XXIII.", "Mawmenee [1]. XX."
  const TITLE = String.raw`(?:[A-Z][A-Z0-9 ,.'’&\-\[\]]*?|[A-Z][a-z]+(?: \[\d+\])?)`
  const NUM = String.raw`(?:[CXLVI]+\.? ?)+`
  const HEAD = new RegExp(String.raw`^(${TITLE})\. ?(${NUM})\.?$`)
  const blocks = part.split(new RegExp(String.raw`\n(?=${TITLE}\. ?${NUM}\.?\s*\n)`))
  const out: Historical[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    const [headLine, ...restLines] = block.split('\n')
    const m = headLine.trim().match(HEAD)
    if (!m) continue
    const paras = paragraphs(restLines.join('\n'))
    const recipe = paras.filter((p) => !/^\[\d+\]/.test(p))
    const glosses = paras.filter((p) => /^\[\d+\]/.test(p))
    if (!recipe.length || recipe.join(' ').length < 40) continue
    const no = m[2].replace(/\s+/g, '').replace(/\.$/, '')
    m[1] = m[1].replace(/ ?\[\d+\]/g, '').trim()
    let id = `formeofcury-${m[1].toLowerCase().replace(/^for to make /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    while (seen.has(id)) id += '-2'
    seen.add(id)
    out.push({
      id,
      source: 'formeofcury',
      title: `${m[1].charAt(0)}${m[1].slice(1).toLowerCase()} (${no})`,
      ingredients: [],
      tags: [],
      instructions: recipe,
      notes: glosses.length ? glosses : undefined,
      sourceUrl: 'https://www.gutenberg.org/ebooks/8102',
      author: 'Richard II:n hovikeittiömestarit; toim. Samuel Pegge (1780)',
      license: 'Public domain',
      year: 1390,
    })
  }
  writeFileSync(join(ROOT, 'en/formeofcury.json'), JSON.stringify(out, null, 1))
  console.log(`formeofcury: ${out.length} recipes`)
}

// --- Apicius, De re coquinaria (c. 400 AD), tr. J. D. Vehling 1936: "[12] TITLE" + Latin title, text in capitals, notes indented ---
{
  const text = body(raw(29728))
  const start = text.indexOf('BOOK I. THE CAREFUL EXPERIENCED COOK', text.indexOf('BOOK I. THE CAREFUL') + 1) > 0
    ? text.indexOf('BOOK I. THE CAREFUL EXPERIENCED COOK', text.indexOf('BOOK I. THE CAREFUL') + 1)
    : text.indexOf('BOOK I. THE CAREFUL')
  const lines = text.slice(start).split('\n')
  // Vehling sets the translation in capitals: back to sentence case for reading.
  const sentence = (s: string) => s.toLowerCase().replace(/(^|[.!?]\s+)([a-zà-ü])/g, (_, a, b) => a + b.toUpperCase()).replace(/\bi\b/g, 'I')
  const out: Historical[] = []
  let book = ''
  let current: { no: number; title: string; latin: string; text: string[]; notes: string[] } | null = null
  const flush = () => {
    if (!current) return
    // Drop illustration captions and the editor's transcriptions of old title pages ({Transcription: …}).
    const raw = current.text.join('\n').replace(/\{Transcription[\s\S]*?\}/g, '').replace(/\{Illustration[\s\S]*?\}/g, '').replace(/Celii apitii[\s\S]*$/i, '')
    const recipe = paragraphs(raw).filter((p) => !/^\{/.test(p)).filter((p) => !/^\{Illustration/.test(p) && !/^END OF BOOK|^EXPLICIT|^APICIUS$|^Book [IVX]+$/i.test(p) && !/^[IVXLC]+\.?$/.test(p))
    if (recipe.length) {
      out.push({
        id: `apicius-${String(current.no).padStart(3, '0')}`,
        source: 'apicius',
        title: `${sentence(current.title)}${current.latin ? ` (${current.latin})` : ''}`,
        section: book,
        ingredients: [],
        tags: [],
        // Capitals except the editor's [bracketed] words: the translation itself, back to sentence case.
        instructions: recipe.map((p) => (/[A-Z]{3}/.test(p) && !/[a-z]/.test(p.replace(/\[[^\]]*\]/g, '')) ? sentence(p) : p)),
        notes: current.notes.length ? paragraphs(current.notes.join('\n')) : undefined,
        sourceUrl: 'https://www.gutenberg.org/ebooks/29728',
        author: 'Apicius; engl. J. D. Vehling (1936)',
        license: 'Public domain',
        year: 400,
      })
    }
    current = null
  }
  let inIllustration = false
  let lastNo = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('{Illustration')) inIllustration = true
    if (inIllustration) {
      if (line.includes('}')) inIllustration = false
      continue
    }
    const b = line.match(/^BOOK ([IVX]+)\. (.+)$/)
    if (b) {
      flush()
      book = b[2].replace(/\s*\[\d+\]$/, '')
      continue
    }
    // "[12] TITLE", also "[6] ROSE WINE WITHOUT [1] ROSES", "[221] ANOTHER [sauce] FOR BOILED [birds]"; numbers only go up.
    const head = !lines[i - 1]?.trim() ? line.match(/^\[(\d+)\] (.+)$/) : null
    const no = head ? Number(head[1]) : 0
    if (head && no > lastNo && no <= lastNo + 20 && !/[a-z]/.test(head[2].replace(/\[[^\]]*\]/g, ''))) {
      flush()
      lastNo = no
      const title = head[2].replace(/\s*\[\d+\]/g, '').trim()
      // A short recipe can be all heading: "[220] FOR ROASTS: PEPPER, LOVAGE, … OIL AND WINE." over indented lines.
      const cont: string[] = []
      while (/^ {6}\S/.test(lines[i + 1] ?? '')) cont.push(lines[++i].trim())
      const latinLine = /^\s{2,4}_/.test(lines[i + 1] ?? '') ? lines[++i] : ''
      const latin = latinLine.trim().replace(/_?\s*\[\d+\]\s*_?/g, ' ').replace(/_/g, '').replace(/\s+/g, ' ').trim()
      if (cont.length) current = { no, title: title.split(':')[0], latin, text: [[title, ...cont].join(' ')], notes: [] }
      else current = { no, title, latin, text: [], notes: [] }
      continue
    }
    // After Book X come the excerpts of Vinidarius (Nos. 468–499); the index ends the recipes.
    if (line.startsWith('INDEX and VOCABULARY') || (lastNo >= 499 && /^END OF|^EXPLICIT/.test(line.trim()))) {
      flush()
      break
    }
    if (/^Index|^INDEX/.test(line.trim()) && (current?.no ?? 0) >= 490) {
      flush()
      break
    }
    if (!current) continue
    if (/^ {4}/.test(line)) current.notes.push(line)
    else current.text.push(line)
  }
  flush()
  writeFileSync(join(ROOT, 'en/apicius.json'), JSON.stringify(out, null, 1))
  console.log(`apicius: ${out.length} recipes`)
}

// --- American Cookery (Amelia Simmons, Hartford 1796): "_To Roast Beef._" headings after "_RECEIPTS._";
//     numbered variants ("No. 2. Boil 6 ounces rice …") become recipes of their own ---
{
  const text = body(raw(12815))
  const part = text.slice(text.indexOf('_RECEIPTS._') + '_RECEIPTS._'.length, text.indexOf('\nADVERTISEMENT.'))
  const lines = part.split('\n')
  const out: Historical[] = []
  const seen = new Set<string>()
  let last = ''
  let current: { title: string; lines: string[] } | null = null
  const push = (title: string, paras: string[]) => {
    const base = `simmons-${title.toLowerCase().replace(/\(another.*\)/, '').replace(/^(to|a|an|the|for) /, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    let id = base
    for (let n = 2; seen.has(id); n++) id = `${base}-${n}`
    seen.add(id)
    out.push({
      id,
      source: 'simmons',
      title,
      ingredients: [],
      tags: [],
      instructions: paras,
      sourceUrl: 'https://www.gutenberg.org/ebooks/12815',
      author: 'Amelia Simmons',
      license: 'Public domain',
      year: 1796,
    })
  }
  const flush = () => {
    if (!current) return
    // Chapter captions ("PUDDINGS.") trail the previous recipe; plain sub-headings ("A Sea Pie.", "A Chicken Pie.")
    // start recipes of their own.
    const groups: { title: string; paras: string[] }[] = [{ title: current.title, paras: [] }]
    for (const p of paragraphs(current.lines.join('\n'))) {
      if (/^[A-Z][A-Z .,&]+\.$/.test(p)) continue
      if (/^An? [A-Z][A-Za-z ]{2,20}\.$/.test(p)) groups.push({ title: p.replace(/\.$/, ''), paras: [] })
      else groups[groups.length - 1].paras.push(p)
    }
    for (const g of groups) {
      // "No. 1. …", "No. 2. …" are separate receipts under one heading; text before the first one (or a
      // trailing "N.B." remark) belongs to the first.
      const variants: string[][] = []
      for (const p of g.paras) {
        const no = p.match(/^No\. ?(\d+)\.? (.*)$/)
        if (no && (variants.length === 0 || Number(no[1]) > 1)) variants.push([no[2]])
        else if (no) variants[0].push(no[2])
        else if (variants.length) variants[variants.length - 1].push(p)
        else variants.push([p])
      }
      if (variants.length > 1) variants.forEach((v, k) => push(`${g.title}, No. ${k + 1}`, v))
      else if (variants[0]?.join(' ').length) push(g.title, variants[0])
    }
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // A heading is a paragraph of its own: "_A Rice Pudding_.", "_Potato Pudding_. Baked.", "_Minced Pies_, A Foot Pie.",
    // or one running over two lines ("_To keep White Bullace, Pears, … for tarts or / pies_.").
    let head = ''
    if (!lines[i - 1]?.trim() && line.startsWith('_')) {
      let joined = line
      let j = i
      while (!/_/.test(joined.slice(1)) && lines[j + 1]?.trim()) joined += ` ${lines[++j].trim()}`
      const m = joined.match(/^_([^_]+)_\.?(.*)$/)
      if (m && !lines[j + 1]?.trim() && m[2].length < 36 && /^(\s*$|\.|,|\s+[A-Z])/.test(m[2])) {
        head = (m[1].replace(/\.$/, '') + m[2].replace(/\.$/, '')).replace(/\s+/g, ' ').trim()
        i = j
      }
    }
    if (head) {
      flush()
      // "Another" follows the recipe it is a variant of.
      const title = /^Another\b/i.test(head) ? `${last} (${head.replace(/_/g, '').toLowerCase()})` : head
      if (!/^Another\b/i.test(head)) last = head
      current = { title, lines: [] }
      continue
    }
    current?.lines.push(lines[i])
  }
  flush()
  writeFileSync(join(ROOT, 'en/simmons.json'), JSON.stringify(out, null, 1))
  console.log(`simmons: ${out.length} recipes`)
}
