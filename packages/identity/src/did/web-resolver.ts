import { unicastFetchWrap } from '@atproto-labs/fetch-node'
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
      decodedId.includes('#') ||
      decodedId.includes('@')
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
      hostname.includes('#') ||
      hostname.includes('@')
    ) {
      throw new UnsupportedDidWebPathError(did)
    }

    let url: URL
    try {
      url = new URL(`https://${hostname}${DOC_PATH}`)
    } catch {
      throw new PoorlyFormattedDidError(did)
    }

    if (url.username || url.password) {
      throw new PoorlyFormattedDidError(did)
    }

    if (url.hostname === 'localhost' && this.allowLocalhost) {
      url.protocol = 'http'
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new PoorlyFormattedDidError(did)
    }
    if (
      url.protocol === 'http:' &&
      !(
        this.allowLocalhost &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      )
    ) {
      throw new PoorlyFormattedDidError(did)
    }

    const normalizedHostname = url.hostname.replace(/\.+$/, '')
    await validateGlobalHost(normalizedHostname, this.allowLocalhost)
    const baseFetch = this.fetch ?? globalThis.fetch
    const fetchFn =
      this.allowLocalhost || (this.fetch && this.fetch !== globalThis.fetch)
        ? baseFetch
        : unicastFetchWrap({ fetch: baseFetch })
    return timed(this.timeout, async (signal) => {
      const res = await fetchFn(url, {
        signal,
        redirect: 'error',
        headers: { accept: 'application/did+ld+json,application/json' },
      })

      // Positively not found, versus due to e.g. network error
      if (!res.ok) return null

      const bodyBytes = await readBodyWithLimit(res, MAX_DID_DOC_SIZE, signal)
      const text = new TextDecoder().decode(bodyBytes)
      return JSON.parse(text)
    })
  }
}
