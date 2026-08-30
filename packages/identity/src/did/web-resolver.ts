import { PoorlyFormattedDidError, UnsupportedDidWebPathError } from '../errors'
import { DidCache } from '../types'
import { BaseResolver } from './base-resolver'
import { timed } from './util'

export const DOC_PATH = '/.well-known/did.json'
export const MAX_DID_DOC_SIZE = 64 * 1024 // 64 KiB

function isForbiddenHost(host: string): boolean {
  const normalized = host.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.invalid')
  ) {
    return true
  }
  // IPv6 or bracketed IPv6 (including IPv4-mapped IPv6 like [::ffff:127.0.0.1])
  if (
    normalized.startsWith('[') ||
    normalized.endsWith(']') ||
    normalized.includes(':')
  ) {
    return true
  }
  // IPv4 literals: loopback, private, link-local, broadcast, zero
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
    const parts = normalized.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a >= 224) return true
  }
  return false
}

export class DidWebResolver extends BaseResolver {
  public fetch?: typeof globalThis.fetch

  constructor(
    public timeout: number = 3000,
    public cache?: DidCache,
    fetchFn?: typeof globalThis.fetch,
  ) {
    super(cache)
    this.fetch = fetchFn
  }

  async resolveNoCheck(did: string): Promise<unknown> {
    const parsedId = did.split(':').slice(2).join(':')
    if (!parsedId) {
      throw new PoorlyFormattedDidError(did)
    }

    let decodedId: string
    try {
      decodedId = decodeURIComponent(parsedId)
    } catch {
      throw new PoorlyFormattedDidError(did)
    }

    if (
      decodedId.includes('/') ||
      decodedId.includes('\\') ||
      decodedId.includes('?') ||
      decodedId.includes('#')
    ) {
      throw new UnsupportedDidWebPathError(did)
    }

    const parts = parsedId.split(':')
    if (parts.length < 1) {
      throw new PoorlyFormattedDidError(did)
    } else if (parts.length > 1) {
      throw new UnsupportedDidWebPathError(did)
    }

    let hostname: string
    try {
      hostname = decodeURIComponent(parts[0])
    } catch {
      throw new PoorlyFormattedDidError(did)
    }

    if (
      hostname.includes('/') ||
      hostname.includes('\\') ||
      hostname.includes('?') ||
      hostname.includes('#')
    ) {
      throw new UnsupportedDidWebPathError(did)
    }

    if (!this.fetch) {
      if (hostname.includes(':') || isForbiddenHost(hostname)) {
        throw new Error(`Forbidden hostname "${hostname}"`)
      }
    }

    const path = hostname + DOC_PATH
    const url = new URL(`https://${path}`)
    if (url.hostname === 'localhost' && this.fetch) {
      url.protocol = 'http'
    }

    const fetchFn = this.fetch ?? globalThis.fetch

    return timed(this.timeout, async (signal) => {
      const res = await fetchFn(url, {
        signal,
        redirect: 'error',
        headers: { accept: 'application/did+ld+json,application/json' },
      })

      // Positively not found, versus due to e.g. network error
      if (!res.ok) return null

      const buffer = await res.arrayBuffer()
      if (buffer.byteLength > MAX_DID_DOC_SIZE) {
        throw new Error(
          `Response size exceeds limit (${MAX_DID_DOC_SIZE} bytes)`,
        )
      }

      const text = new TextDecoder().decode(buffer)
      return JSON.parse(text)
    })
  }
}
