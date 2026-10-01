/**
 * SSRF protection for the recipe page fetcher.
 *
 * A URL is fetched only if:
 *   - protocol is http(s), no credentials, default ports only (80/443)
 *   - hostname is not localhost / internal-looking and (by default) is on the allowlist
 *   - EVERY address the hostname resolves to is a public unicast address
 * The connection is then pinned to the validated address (prevents DNS rebinding),
 * and each redirect target is validated again from scratch.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { isAllowedHost } from './allowlist.ts'

// Separate lists: Node's BlockList also matches IPv4 addresses against IPv4-mapped IPv6 rules.
const blockedV4 = new BlockList()
const blockedV6 = new BlockList()
// IPv4 special-purpose ranges (RFC 6890 and friends)
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(net, prefix, 'ipv4')
blockedV4.addAddress('255.255.255.255', 'ipv4')
// IPv6 special-purpose ranges (IPv4-mapped/NAT64 forms are rejected separately in isPublicAddress)
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blockedV6.addSubnet(net, prefix, 'ipv6')

/** Extract an embedded IPv4 address from IPv4-mapped / NAT64 IPv6 forms. */
function embeddedIpv4(address: string): string | null {
  const m = address.toLowerCase().match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)
  if (m) return m[1]
  const hex = address.toLowerCase().match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const a = parseInt(hex[1], 16)
    const b = parseInt(hex[2], 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return null
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 4) return !blockedV4.check(address, 'ipv4')
  // IPv4-mapped / NAT64 forms can smuggle private IPv4 targets and are never needed for recipe sites.
  if (embeddedIpv4(address) || /^::ffff:/i.test(address)) return false
  return !blockedV6.check(address, 'ipv6')
}

export class FetchPolicyError extends Error {
  code: 'invalid-url' | 'not-allowed' | 'private-address'
  constructor(code: FetchPolicyError['code'], message: string) {
    super(message)
    this.code = code
  }
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.arpa']

export interface ValidatedTarget {
  url: URL
  address: string
  family: 4 | 6
}

export interface PolicyOptions {
  /** Allow any public host instead of the recipe-site allowlist. */
  allowAnyHost?: boolean
  /** Injected for tests. */
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>
}

export async function validateTarget(input: string | URL, opts: PolicyOptions = {}): Promise<ValidatedTarget> {
  let url: URL
  try {
    url = typeof input === 'string' ? new URL(input) : input
  } catch {
    throw new FetchPolicyError('invalid-url', 'Virheellinen URL-osoite.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchPolicyError('invalid-url', 'Vain http- ja https-osoitteet ovat sallittuja.')
  }
  if (url.username || url.password) throw new FetchPolicyError('invalid-url', 'Käyttäjätunnuksia sisältävät osoitteet eivät ole sallittuja.')
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new FetchPolicyError('not-allowed', 'Vain oletusportit (80/443) ovat sallittuja.')
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new FetchPolicyError('private-address', 'Paikallisiin tai sisäverkon osoitteisiin ei voi tehdä pyyntöjä.')
  }
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new FetchPolicyError('private-address', 'Yksityisiin IP-osoitteisiin ei voi tehdä pyyntöjä.')
    if (!opts.allowAnyHost) throw new FetchPolicyError('not-allowed', 'IP-osoitteita ei sallita – käytä reseptisivuston osoitetta.')
    return { url, address: host, family: isIP(host) as 4 | 6 }
  }
  if (!host.includes('.')) throw new FetchPolicyError('private-address', 'Sisäverkon nimiin ei voi tehdä pyyntöjä.')
  if (!opts.allowAnyHost && !isAllowedHost(host)) {
    throw new FetchPolicyError('not-allowed', `Sivustoa ${host} ei tueta automaattisessa tuonnissa. Voit liittää sivun HTML-lähdekoodin käsin.`)
  }
  const resolve = opts.resolve ?? ((h: string) => dnsLookup(h, { all: true, verbatim: true }))
  let addresses: { address: string; family: number }[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new FetchPolicyError('invalid-url', `Palvelinta ${host} ei löytynyt.`)
  }
  if (addresses.length === 0) throw new FetchPolicyError('invalid-url', `Palvelinta ${host} ei löytynyt.`)
  const bad = addresses.find((a) => !isPublicAddress(a.address))
  if (bad) throw new FetchPolicyError('private-address', 'Osoite ohjautuu yksityiseen verkkoon – pyyntö estetty.')
  const first = addresses[0]
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 }
}
