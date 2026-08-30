import { PoorlyFormattedDidError, UnsupportedDidWebPathError } from '../errors'
import { DidCache } from '../types'
import { readBodyWithLimit, validateGlobalHost } from '../util'
import { BaseResolver } from './base-resolver'
import { timed } from './util'

export const DOC_PATH = '/.well-known/did.json'
export const MAX_DID_DOC_SIZE = 64 * 1024 // 64 KiB

export class DidWebResolver extends BaseResolver {
  public fetch?: typeof globalThis.fetch
  public allowLocalhost: boolean

  constructor(
    public timeout: number = 3000,
    public cache?: DidCache,
    fetchFn?: typeof globalThis.fetch,
    allowLocalhost = false,
  ) {
    super(cache)
    this.fetch = fetchFn
    this.allowLocalhost = allowLocalhost
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

    await validateGlobalHost(hostname, this.allowLocalhost)

    const path = hostname + DOC_PATH
    const url = new URL(`https://${path}`)
    if (url.hostname === 'localhost' && this.allowLocalhost) {
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

      const bodyBytes = await readBodyWithLimit(res, MAX_DID_DOC_SIZE)
      const text = new TextDecoder().decode(bodyBytes)
      return JSON.parse(text)
    })
  }
}
