import { DidCache } from '../types'
import { readBodyWithLimit } from '../util'
import { BaseResolver } from './base-resolver'
import { timed } from './util'

export const MAX_PLC_DOC_SIZE = 64 * 1024 // 64 KiB

export class DidPlcResolver extends BaseResolver {
  public fetch?: typeof globalThis.fetch
  public allowLocalhost: boolean

  constructor(
    public plcUrl: string,
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
    return timed(this.timeout, async (signal) => {
      const url = new URL(`/${encodeURIComponent(did)}`, this.plcUrl)
      const fetchFn = this.fetch ?? globalThis.fetch
      const res = await fetchFn(url, {
        redirect: 'error',
        headers: { accept: 'application/did+ld+json,application/json' },
        signal,
      })

      // Positively not found, versus due to e.g. network error
      if (res.status === 404) return null

      if (!res.ok) {
        throw Object.assign(new Error(res.statusText), { status: res.status })
      }

      const bodyBytes = await readBodyWithLimit(res, MAX_PLC_DOC_SIZE, signal)
      const text = new TextDecoder().decode(bodyBytes)
      return JSON.parse(text)
    })
  }
}
