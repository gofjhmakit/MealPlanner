import { describe, expect, it } from 'vitest'
import { isAllowedHost } from '../server/allowlist'
import { FetchPolicyError, isPublicAddress, validateTarget } from '../server/ssrf'

const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

describe('address classification', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1'])(
    'blocks %s',
    (ip) => expect(isPublicAddress(ip)).toBe(false),
  )
  it.each(['104.21.85.151', '8.8.8.8', '2606:4700::6810:84e5'])('allows public %s', (ip) => expect(isPublicAddress(ip)).toBe(true))
})

describe('URL validation', () => {
  const reject = async (url: string, code: string, opts = {}) => {
    await expect(validateTarget(url, opts)).rejects.toMatchObject({ code })
  }

  it('allows supported recipe sites that resolve publicly', async () => {
    const t = await validateTarget('https://www.valio.fi/reseptit/x/', { resolve: resolveTo('104.21.85.151') })
    expect(t.address).toBe('104.21.85.151')
  })

  it('rejects non-HTTP protocols, credentials and odd ports', async () => {
    await reject('file:///etc/passwd', 'invalid-url')
    await reject('ftp://valio.fi/', 'invalid-url')
    await reject('https://user:pw@valio.fi/', 'invalid-url')
    await reject('https://valio.fi:8443/', 'not-allowed')
    await reject('not a url', 'invalid-url')
  })

  it('rejects localhost, internal names and private IP literals', async () => {
    await reject('http://localhost/', 'private-address')
    await reject('http://printer.local/', 'private-address')
    await reject('http://intranet/', 'private-address')
    await reject('http://127.0.0.1/', 'private-address')
    await reject('http://[::1]/', 'private-address')
    await reject('http://169.254.169.254/latest/meta-data', 'private-address')
  })

  it('rejects hosts outside the allowlist (no open proxy)', async () => {
    await reject('https://example.com/', 'not-allowed')
    await reject('https://valio.fi.evil.com/', 'not-allowed')
    await reject('https://8.8.8.8/', 'not-allowed')
  })

  it('rejects allowed names that resolve to private addresses (DNS rebinding)', async () => {
    await reject('https://www.valio.fi/', 'private-address', { resolve: resolveTo('104.21.85.151', '10.0.0.5') })
    await reject('https://www.valio.fi/', 'private-address', { resolve: resolveTo('::ffff:192.168.0.1') })
  })

  it('allowAnyHost still enforces address checks', async () => {
    const t = await validateTarget('https://example.com/', { allowAnyHost: true, resolve: resolveTo('93.184.216.34') })
    expect(t.address).toBe('93.184.216.34')
    await reject('https://evil.example/', 'private-address', { allowAnyHost: true, resolve: resolveTo('127.0.0.1') })
  })

  it('exposes a typed error', async () => {
    await expect(validateTarget('http://localhost')).rejects.toBeInstanceOf(FetchPolicyError)
  })

  it('allowlist matches subdomains only on label boundaries', () => {
    expect(isAllowedHost('www.k-ruoka.fi')).toBe(true)
    expect(isAllowedHost('yhteishyva.fi')).toBe(true)
    expect(isAllowedHost('notvalio.fi')).toBe(false)
  })
})
