import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/domain/command'
import { householdServings, suggestTargets } from '../src/domain/goals'

describe('command bar parser', () => {
  const fri = '2026-10-09' // a Friday
  it('picks out day, slot and search words', () => {
    const c = parseCommand('su lounas kana', fri)
    expect(c).toMatchObject({ date: '2026-10-11', slot: 'lunch', query: 'kana', action: null })
    expect(c.tokens.map((t) => t.kind)).toEqual(['day', 'slot'])
  })
  it('understands relative days, inflected slot words and next week', () => {
    expect(parseCommand('huomenna päivälliseksi lohi', fri)).toMatchObject({ date: '2026-10-10', slot: 'dinner', query: 'lohi' })
    expect(parseCommand('pe aamiainen', fri).date).toBe(fri)
    expect(parseCommand('ensi ma', fri).date).toBe('2026-10-12')
    expect(parseCommand('ensi pe', fri).date).toBe('2026-10-16')
    expect(parseCommand('12.10. iltapala', fri)).toMatchObject({ date: '2026-10-12', slot: 'snack', query: '' })
  })
  it('recognises actions only as the first word', () => {
    expect(parseCommand('täytä', fri).action).toBe('fill')
    expect(parseCommand('kana täytä', fri)).toMatchObject({ action: null, query: 'kana täytä' })
  })
  it('leaves plain searches alone', () => {
    expect(parseCommand('kermainen lohikeitto', fri)).toMatchObject({ date: null, slot: null, query: 'kermainen lohikeitto' })
  })
})

describe('goals and household', () => {
  it('suggests a deficit target with protein for a man who wants to lose weight', () => {
    const t = suggestTargets({ sex: 'male', age: 35, heightCm: 180, weightKg: 92, activity: 1.5, aim: 'lose' })
    // BMR 1 865 × 1.5 = 2 798 − 500 ≈ 2 300
    expect(t.energyKcal).toBe(2300)
    expect(t.protein).toBe(140) // weight capped at BMI 27 (87.5 kg) × 1.6
    expect(t.fibre).toBe(35)
  })
  it('never goes below the safe floor', () => {
    expect(suggestTargets({ sex: 'female', age: 70, heightCm: 150, weightKg: 45, activity: 1.3, aim: 'lose' }).energyKcal).toBe(1200)
  })
  it('counts servings from portions', () => {
    expect(householdServings([{ id: 'a', name: 'A', kind: 'adult', portion: 1 }, { id: 'b', name: 'B', kind: 'adult', portion: 1 }, { id: 'c', name: 'C', kind: 'child', portion: 0.6 }], 4)).toBe(3)
    expect(householdServings([], 4)).toBe(4)
  })
})

describe('chicken spelling variants', () => {
  it('match fillets and pieces, never a whole 1.2 kg chicken', async () => {
    const { buildIngredientList } = await import('../src/domain/recipeIngredients')
    const { fineliLookup } = await import('./helpers')
    const ings = buildIngredientList(['2 broilerin rintafilettä', '4 broilerin palaa ilman nahkaa', '400 g broilerin rintafileetä'], { fineli: fineliLookup() } as never)
    expect(ings.map((i) => i.canonicalId)).toEqual(['chicken-breast', 'chicken-thigh', 'chicken-breast'])
  })
})

describe('v2 helpers', () => {
  it('finds durations in instructions', async () => {
    const { splitTimers } = await import('../src/domain/timers')
    const parts = splitTimers('Hauduta 20–25 minuuttia ja anna levätä 1 tunti.')
    expect(parts.filter((p) => typeof p !== 'string')).toEqual([
      { text: '20–25 minuuttia', seconds: 1500 },
      { text: '1 tunti', seconds: 3600 },
    ])
    expect(splitTimers('Lisää 2 dl vettä.')).toEqual(['Lisää 2 dl vettä.'])
  })
  it('offers the first empty main meal that has not passed yet', async () => {
    const { nextEmptySlot } = await import('../src/domain/today')
    const items = [{ date: '2026-10-09', slot: 'dinner' as const }]
    expect(nextEmptySlot(items, '2026-10-09', 16)).toEqual({ date: '2026-10-10', slot: 'breakfast' })
    expect(nextEmptySlot([], '2026-10-09', 9)).toEqual({ date: '2026-10-09', slot: 'breakfast' })
    expect(nextEmptySlot(items, '2026-10-09', 16, { preferSlot: 'dinner' })).toEqual({ date: '2026-10-10', slot: 'dinner' })
  })
  it('rounds shopping amounts to what you buy, with Finnish partitives', async () => {
    const { formatShoppingAmount } = await import('../src/domain/shoppingList')
    const amt = (o: Partial<{ mass: number; volume: number; counts: Record<string, number> }>) => ({ mass: null, volume: null, counts: {}, unquantified: 0, ...o })
    expect(formatShoppingAmount(amt({ mass: 265 }))).toBe('300 g')
    expect(formatShoppingAmount(amt({ counts: { ruukku: 1.5 } }))).toBe('2 ruukkua')
    expect(formatShoppingAmount(amt({ counts: { kynsi: 6 } }))).toBe('6 kynttä')
    expect(formatShoppingAmount(amt({ counts: { kpl: 0.5 } }))).toBe('1 kpl')
    expect(formatShoppingAmount(amt({ volume: 430 }))).toBe('4 ½ dl')
  })
  it('asks "onko kotona?" only for staples and small amounts', async () => {
    const { isStapleLike } = await import('../src/domain/shoppingList')
    const base = { mass: null, volume: null, counts: {}, unquantified: 0 }
    expect(isStapleLike({ name: 'Kaneli', category: 'spices_sauces', amount: { ...base, volume: 5 } })).toBe(true)
    expect(isStapleLike({ name: 'Oliiviöljy', category: 'other', amount: { ...base, volume: 30 } })).toBe(true)
    expect(isStapleLike({ name: 'Broilerin fileesuikale', category: 'meat_fish', amount: { ...base, mass: 450 } })).toBe(false)
  })
})
