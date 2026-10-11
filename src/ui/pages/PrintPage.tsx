/**
 * Printable week (/tulosta?alku=YYYY-MM-DD&osat=ohjelma,reseptit,ostokset): the menu as a
 * landscape timetable, the week's recipes and its shopping list on portrait pages. Opens the
 * browser's print dialog, where "Tallenna PDF-tiedostona" gives the PDF. Small type, no photos –
 * meant to save paper and ink.
 */
import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { shoppingNeedsForRange } from '../../db/repo'
import { addDays, capitalize, formatDate, isoWeek, parseISODate, weekdayName } from '../../domain/dates'
import { splitAmountText } from '../../domain/ingredientParser'
import { recipeNutritionCached, recipeTime } from '../../domain/recipeInfo'
import { scaleIngredient } from '../../domain/scaling'
import { CATEGORY_LABELS, formatShoppingAmount, pantryMatcher, type AggregatedItem } from '../../domain/shoppingList'
import { SHOPPING_CATEGORIES, type MealItem, type MealSlot, type Recipe } from '../../domain/types'
import { formatNumber } from '../../domain/units'
import { useApp } from '../AppContext'
import type { PrintPart } from '../components/PrintDialog'
import { Spinner } from '../components/ui'
import { SLOT_LABELS, useBack, useMealItems, useRecipesById } from '../hooks'

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other']

export function PrintPage() {
  const [params] = useSearchParams()
  const start = params.get('alku') ?? ''
  const parts = new Set((params.get('osat') ?? 'ohjelma').split(',') as PrintPart[])
  const end = addDays(start, 6)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const { fineli, settings, nutritionCache } = useApp()
  const back = useBack('/viikko')
  const items = useMealItems(start, end)
  const recipes = useRecipesById(items?.map((i) => i.recipeId) ?? [])
  const [shopping, setShopping] = useState<AggregatedItem[] | null>(null)

  useEffect(() => {
    if (!parts.has('ostokset') || !items) return
    void shoppingNeedsForRange(start, end, fineli).then(setShopping)
  }, [items, start, end, fineli]) // eslint-disable-line react-hooks/exhaustive-deps -- parts is derived from the URL

  const ready = !!items && !!recipes && (!parts.has('ostokset') || !!shopping)
  const printed = useRef(false)
  useEffect(() => {
    if (!ready || printed.current) return
    printed.current = true
    document.title = `Ruokalista viikko ${isoWeek(start)}`
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [ready, start])

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return <p className="p-6">Viikkoa ei valittu.</p>
  if (!ready) return <Spinner label="Valmistellaan tulostetta…" />

  const kcalOf = (r: Recipe) => recipeNutritionCached(r, { lookup: fineli, pantry: settings.pantry, nutritionCache }).perServing.energyKcal
  const range = `${formatDate(start)}–${formatDate(end, { year: true })}`

  return (
    <div className="print-root" lang="fi">
      <style>{PRINT_CSS}</style>
      <div className="pr-toolbar">
        <button onClick={back} className="pr-btn"><ArrowLeft size={16} /> Takaisin</button>
        <button onClick={() => window.print()} className="pr-btn pr-btn-main"><Printer size={16} /> Tulosta tai tallenna PDF</button>
        <span>Tulostusikkunassa: tulostin ”Tallenna PDF-tiedostona” antaa PDF:n. Ruokalista tulostuu vaakasuuntaan.</span>
      </div>
      {parts.has('ohjelma') && <Schedule days={days} items={items} recipes={recipes} kcalOf={kcalOf} title={`Ruokalista · viikko ${isoWeek(start)}`} range={range} />}
      {parts.has('reseptit') && <Recipes items={items} recipes={recipes} title={`Viikon ${isoWeek(start)} reseptit`} />}
      {parts.has('ostokset') && shopping && <Shopping items={shopping} pantry={settings.pantry} title={`Ostoslista · viikko ${isoWeek(start)}`} range={range} />}
    </div>
  )
}

function dayLabel(d: string): string {
  return `${capitalize(weekdayName(d))} ${parseISODate(d).getDate()}.${parseISODate(d).getMonth() + 1}.`
}

function Schedule({ days, items, recipes, kcalOf, title, range }: { days: string[]; items: MealItem[]; recipes: Map<string, Recipe>; kcalOf: (r: Recipe) => number; title: string; range: string }) {
  const slots = SLOT_ORDER.filter((s) => s === 'breakfast' || s === 'lunch' || s === 'dinner' || items.some((i) => i.slot === s))
  const cell = (d: string, s: MealSlot) => items.filter((i) => i.date === d && i.slot === s && i.status !== 'skipped').sort((a, b) => a.position - b.position)
  const dayKcal = (d: string) => items.filter((i) => i.date === d && i.status !== 'skipped' && i.recipeId).reduce((sum, i) => sum + (recipes.get(i.recipeId!) ? kcalOf(recipes.get(i.recipeId!)!) : 0), 0)
  return (
    <section className="pr-schedule">
      <header className="pr-head">
        <h1>{title}</h1>
        <span>{range}</span>
      </header>
      <table className="pr-table">
        <colgroup>
          <col style={{ width: '8%' }} />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            <th />
            {days.map((d) => <th key={d}>{dayLabel(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s}>
              <th scope="row">{SLOT_LABELS[s]}</th>
              {days.map((d) => (
                <td key={d}>
                  {cell(d, s).map((i) => {
                    const r = i.recipeId ? recipes.get(i.recipeId) : undefined
                    const time = r && !i.leftoverOfId ? recipeTime(r) : null
                    return (
                      <div key={i.id} className="pr-meal">
                        <b>{i.leftoverOfId ? '↻ ' : ''}{r?.title ?? i.note ?? 'Ateria'}</b>
                        <small>
                          {i.leftoverOfId
                            ? 'tähteet, ei kokkausta'
                            : [`${formatNumber(i.servings, 1)} hlö${i.extraServings ? ` + ${formatNumber(i.extraServings, 1)} huomiseksi` : ''}`, time ? `${time} min` : null].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                    )
                  })}
                </td>
              ))}
            </tr>
          ))}
          <tr className="pr-kcal">
            <th scope="row">Energia</th>
            {days.map((d) => <td key={d}>{dayKcal(d) ? `≈ ${formatNumber(dayKcal(d), 0)} kcal / hlö` : ''}</td>)}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function Recipes({ items, recipes, title }: { items: MealItem[]; recipes: Map<string, Recipe>; title: string }) {
  // Each cooked recipe once, in menu order, at the portions of its first cooking (leftovers included).
  const cooked = useMemo(() => {
    const seen = new Map<string, { recipe: Recipe; servings: number; extra: number; when: string[] }>()
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    for (const i of sorted) {
      const r = i.recipeId ? recipes.get(i.recipeId) : undefined
      if (!r || i.leftoverOfId || i.status === 'skipped') continue
      const when = `${capitalize(weekdayName(i.date, true))} ${SLOT_LABELS[i.slot].toLowerCase()}`
      const e = seen.get(r.id)
      if (e) e.when.push(when)
      else seen.set(r.id, { recipe: r, servings: i.servings, extra: i.extraServings ?? 0, when: [when] })
    }
    return [...seen.values()]
  }, [items, recipes])
  if (!cooked.length) return null
  return (
    <section className="pr-recipes">
      <header className="pr-head">
        <h1>{title}</h1>
        <span>{cooked.length} reseptiä</span>
      </header>
      <div className="pr-recipe-list">
      {cooked.map(({ recipe, servings, extra, when }) => {
        const total = servings + extra
        const factor = total / recipe.servings
        const time = recipeTime(recipe)
        return (
          <article key={recipe.id} className="pr-recipe">
            <h2>{recipe.title}</h2>
            <p className="pr-meta">
              {[when.join(', '), `${formatNumber(total, 1)} annosta${extra ? ` (${formatNumber(servings, 1)} + ${formatNumber(extra, 1)} huomiseksi)` : ''}`, time ? `${time} min` : null, recipe.sourceName ? `Lähde: ${recipe.sourceName}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="pr-recipe-body">
              <ul className="pr-ings">
                {recipe.ingredients.map((ing) => {
                  if (/:$/.test(ing.raw)) return <li key={ing.id} className="pr-group">{ing.raw.slice(0, -1)}</li>
                  const scaled = scaleIngredient(ing, factor)
                  const split = splitAmountText(ing.raw)
                  const amount = factor === 1 ? split.amount : scaled.quantity != null ? scaled.amountText : ''
                  return (
                    <li key={ing.id}>
                      <span className="pr-amt">{amount}</span>
                      <span>{split.rest || ing.raw}</span>
                    </li>
                  )
                })}
              </ul>
              {recipe.instructions.length > 0 ? (
                <ol className="pr-steps">
                  {recipe.instructions.map((s, n) => <li key={n}>{s}</li>)}
                </ol>
              ) : (
                <p className="pr-steps">Ei valmistusohjetta.</p>
              )}
            </div>
          </article>
        )
      })}
      </div>
    </section>
  )
}

function Shopping({ items, pantry, title, range }: { items: AggregatedItem[]; pantry: string[]; title: string; range: string }) {
  const atHome = pantryMatcher(pantry)
  const buy = items.filter((i) => !atHome(i))
  const home = items.filter((i) => atHome(i))
  return (
    <section className="pr-shopping">
      <header className="pr-head">
        <h1>{title}</h1>
        <span>{range} · {buy.length} tuotetta</span>
      </header>
      <div className="pr-cols">
        {SHOPPING_CATEGORIES.map((c) => {
          const list = buy.filter((i) => i.category === c).sort((a, b) => a.name.localeCompare(b.name, 'fi'))
          if (!list.length) return null
          return (
            <div key={c} className="pr-cat">
              <h3>{CATEGORY_LABELS[c]}</h3>
              <ul>
                {list.map((i) => (
                  <li key={i.key}>
                    <span className="pr-box" />
                    <span className="pr-name">{i.name}</span>
                    <span className="pr-amt">{formatShoppingAmount(i.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
      {home.length > 0 && <p className="pr-note">Kotona yleensä (tarkista): {home.map((i) => i.name).join(', ')}.</p>}
    </section>
  )
}

/** Plain CSS: fixed print colours (also in dark mode), A4 landscape for the menu, portrait for the rest. */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 11mm 12mm; }
@page menu { size: A4 landscape; margin: 9mm 10mm; }
.print-root { background: #e9e9e9; color: #111; min-height: 100vh; padding: 64px 16px 24px; font-size: 9pt; line-height: 1.35; }
.print-root section { background: #fff; color: #111; margin: 0 auto 16px; padding: 10mm; box-shadow: 0 1px 4px rgb(0 0 0 / .15); }
.pr-schedule { width: 297mm; max-width: 100%; page: menu; }
.pr-recipes, .pr-shopping { width: 210mm; max-width: 100%; }
.pr-toolbar { position: fixed; inset: 0 0 auto 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ccc; font-size: 13px; color: #444; }
.pr-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 10px; border: 1px solid #ccc; background: #fff; color: #111; font-weight: 500; }
.pr-btn-main { background: #1f5c46; border-color: #1f5c46; color: #fff; }
.pr-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 1.5pt solid #111; padding-bottom: 2mm; margin-bottom: 3mm; }
.pr-head h1 { font-size: 15pt; font-weight: 700; margin: 0; }
.pr-head span { font-size: 9pt; color: #444; }
.pr-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.pr-table th, .pr-table td { border: 0.6pt solid #888; padding: 1.6mm 1.8mm; vertical-align: top; text-align: left; }
.pr-table thead th { background: #eee; font-size: 9.5pt; font-weight: 700; }
.pr-table tbody th { background: #f5f5f5; font-size: 8.5pt; font-weight: 600; hyphens: manual; overflow-wrap: normal; white-space: nowrap; }
.pr-schedule .pr-table { height: 172mm; }
.pr-kcal { height: 7mm; }
.pr-meal + .pr-meal { margin-top: 1.5mm; padding-top: 1.5mm; border-top: 0.4pt dashed #aaa; }
.pr-meal b { display: block; font-size: 9.5pt; font-weight: 600; line-height: 1.25; }
.pr-meal small { display: block; font-size: 7.5pt; color: #555; margin-top: 0.5mm; }
.pr-kcal td, .pr-kcal th { font-size: 7.5pt; color: #555; padding-top: 1mm; padding-bottom: 1mm; }
.pr-recipe-list { columns: 2; column-gap: 7mm; column-rule: 0.4pt solid #ccc; }
.pr-recipe { break-inside: avoid; padding: 0 0 3mm; margin-bottom: 3mm; border-bottom: 0.6pt solid #bbb; }
.pr-recipe h2 { font-size: 11.5pt; font-weight: 700; margin: 0; }
.pr-meta { font-size: 7.5pt; color: #555; margin: 0.5mm 0 2mm; }
.pr-recipe-body { display: block; }
.pr-steps { margin-top: 1.5mm !important; }
.pr-ings { list-style: none; margin: 0; padding: 0; font-size: 8.5pt; }
.pr-ings li { display: flex; gap: 2mm; padding: 0.3mm 0; }
.pr-ings .pr-amt { flex: 0 0 13mm; text-align: right; font-weight: 600; }
.pr-ings .pr-group { display: block; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; margin-top: 1.5mm; }
.pr-steps { margin: 0; padding-left: 4.5mm; font-size: 8.5pt; }
.pr-steps li { margin-bottom: 0.8mm; }
.print-root { hyphens: auto; overflow-wrap: anywhere; }
.pr-cols { columns: 3; column-gap: 7mm; }
.pr-cat { break-inside: avoid; margin-bottom: 3mm; }
.pr-cat h3 { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-bottom: 0.6pt solid #888; margin: 0 0 1mm; padding-bottom: 0.5mm; }
.pr-cat ul { list-style: none; margin: 0; padding: 0; }
.pr-cat li { display: flex; align-items: baseline; gap: 1.8mm; font-size: 8.5pt; padding: 0.5mm 0; }
.pr-box { flex: 0 0 auto; width: 2.6mm; height: 2.6mm; border: 0.7pt solid #333; border-radius: 0.5mm; transform: translateY(0.3mm); }
.pr-name { flex: 1; min-width: 0; }
.pr-cat .pr-amt { color: #444; white-space: nowrap; }
.pr-note { margin-top: 3mm; font-size: 7.5pt; color: #555; }
@media print {
  .pr-toolbar { display: none !important; }
  .print-root { background: #fff; padding: 0; min-height: 0; }
  .print-root section { box-shadow: none; margin: 0; padding: 0; width: auto; max-width: none; }
  .print-root section + section { break-before: page; }
}
`
