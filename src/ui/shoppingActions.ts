/**
 * Adding a typed item to a shopping list: "2 kg perunoita" → Peruna, 2 kg, on the vegetable shelf,
 * shown together with potatoes the recipes need. Unknown things ("Fairy") stay as typed under "Muut".
 */
import { addManualShoppingItem, ROLLING_LIST_ID } from '../db/repo'
import { capitalize } from '../domain/dates'
import { splitAmountText } from '../domain/ingredientParser'
import { getIngredient } from '../domain/ingredients'
import { matchIngredient, type FineliLookup } from '../domain/matcher'
import type { ShoppingCategory } from '../domain/types'

export async function addTypedShoppingItem(
  text: string,
  o: { fineli: FineliLookup; listId?: string; amount?: string; category?: ShoppingCategory | 'auto' },
): Promise<string | null> {
  const split = o.amount?.trim() ? { amount: o.amount.trim(), rest: text.trim() } : splitAmountText(text)
  if (/^\d+([,.]\d+)?$/.test(split.amount)) split.amount += ' kpl'
  const typed = split.rest || text.trim()
  if (!typed) return null
  const m = matchIngredient(typed, { fineli: o.fineli })
  const canonical = m.confidence >= 0.5 ? getIngredient(m.canonicalId) : undefined
  const name = canonical?.fi ?? capitalize(typed)
  const category = !o.category || o.category === 'auto' ? (canonical?.category ?? 'other') : o.category
  await addManualShoppingItem(o.listId ?? ROLLING_LIST_ID, name, split.amount, category, undefined, canonical ? `c:${canonical.id}` : undefined)
  return split.amount ? `${name} ${split.amount}` : name
}
