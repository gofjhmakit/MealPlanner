import { useLiveQuery } from 'dexie-react-hooks'
import { Package, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { db } from '../../db/db'
import { productDisplayName } from '../../domain/products'
import { matchesQuery } from '../../domain/recipeInfo'
import { CATEGORY_LABELS } from '../../domain/shoppingList'
import { formatNumber } from '../../domain/units'
import { safeHttpUrl } from '../../domain/url'
import { PageHeader } from '../components/Layout'
import { Badge, Button, EmptyState, Spinner, TextInput } from '../components/ui'

export function ProductsPage() {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const usage = useLiveQuery(async () => {
    const counts = new Map<number, number>()
    await db.recipes.filter((r) => r.origin !== 'catalogue').each((r) => {
      for (const id of new Set(r.ingredients.map((i) => i.fineliId).filter((x): x is number => typeof x === 'number' && x >= 900_000_000))) counts.set(id, (counts.get(id) ?? 0) + 1)
    })
    return counts
  }, [])
  const [query, setQuery] = useState('')
  const list = useMemo(
    () =>
      (products ?? [])
        .filter((p) => !query || matchesQuery(`${p.name} ${p.brand ?? ''} ${p.aliases.join(' ')} ${p.ean ?? ''}`.toLowerCase(), query))
        .sort((a, b) => productDisplayName(a).localeCompare(productDisplayName(b), 'fi')),
    [products, query],
  )

  return (
    <div className="fade-in">
      <PageHeader
        title="Omat tuotteet"
        subtitle="Tuotteet, joita Finelissä ei ole – ravintoarvot pakkauksesta tai K-Ruoan / S-kauppojen tuotesivulta. Reseptit tunnistavat ne automaattisesti."
        actions={<Link to="/tuotteet/uusi"><Button icon={<Plus size={16} />}>Lisää tuote</Button></Link>}
      />
      {!products ? (
        <Spinner />
      ) : products.length === 0 ? (
        <EmptyState icon={<Package size={32} />} title="Ei vielä omia tuotteita" action={<Link to="/tuotteet/uusi"><Button>Lisää ensimmäinen tuote</Button></Link>}>
          Lisää esimerkiksi suosikkijogurttisi tai rasvaseoksesi. Tuo tiedot verkkokaupan tuotesivulta tai kirjoita ne pakkauksesta.
        </EmptyState>
      ) : (
        <>
          <div className="relative mb-4 max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" />
            <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä, merkillä tai EAN-koodilla" className="pl-9" aria-label="Hae tuotteita" />
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => {
              const img = safeHttpUrl(p.imageUrl)
              const used = usage?.get(p.foodId) ?? 0
              return (
                <li key={p.id}>
                  <Link to={`/tuotteet/${p.id}`} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:shadow-md">
                    {img ? (
                      <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg bg-white object-contain" />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Package size={24} /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{productDisplayName(p)}</span>
                      <span className="tabular block text-xs text-muted">
                        {formatNumber(p.nutrients.energyKcal, 0)} kcal · P {formatNumber(p.nutrients.protein ?? 0, 1)} g · HH {formatNumber(p.nutrients.carbohydrate ?? 0, 1)} g · R {formatNumber(p.nutrients.fat ?? 0, 1)} g / 100 g
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Badge>{CATEGORY_LABELS[p.category]}</Badge>
                        {used > 0 && <Badge tone="brand">{used} reseptissä</Badge>}
                        {p.source !== 'manual' && <Badge tone="accent">{p.source === 'k-ruoka' ? 'K-Ruoka' : p.source === 's-kaupat' ? 'S-kaupat' : 'tuotu'}</Badge>}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
