/**
 * Recipe sites the fetch service is allowed to contact (subdomains included).
 * Keep in sync with the adapters in src/import/adapters/index.ts.
 * Extra domains can be added at runtime with RECIPE_FETCH_EXTRA_DOMAINS="example.fi,other.fi".
 */
export const ALLOWED_DOMAINS = [
  'k-ruoka.fi', 'pirkka.fi', // K-Ruoka adapter
  'yhteishyva.fi', 's-kaupat.fi', 'foodie.fi', // Yhteishyvä adapter
  'valio.fi', // Valio adapter
  'arla.fi', 'kotikokki.net', // generic Schema.org JSON-LD (verified 2026-10)
]

function extraDomains(): string[] {
  const env = typeof process !== 'undefined' ? process.env.RECIPE_FETCH_EXTRA_DOMAINS : undefined
  return (env ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
}

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return [...ALLOWED_DOMAINS, ...extraDomains()].some((d) => host === d || host.endsWith(`.${d}`))
}
