import { unicastFetchWrap } from '@atproto-labs/fetch-node'
import dns from 'node:dns/promises'
import net from 'node:net'
import { HandleResolverOpts } from '../types'
import { readBodyWithLimit, validateGlobalHost } from '../util'

const SUBDOMAIN = '_atproto'
const PREFIX = 'did='
export const MAX_HANDLE_BODY_SIZE = 10 * 1024 // 10 KiB

export class HandleResolver {
  public timeout: number
  public fetch?: typeof globalThis.fetch
  public allowLocalhost: boolean
  private backupNameservers: string[] | undefined
  private backupNameserverIps: string[] | undefined

  constructor(opts: HandleResolverOpts = {}) {
    this.timeout = opts.timeout ?? 3000
    this.backupNameservers = opts.backupNameservers
    this.fetch = opts.fetch
    this.allowLocalhost = opts.allowLocalhost ?? false
  }

  async resolve(handle: string): Promise<string | undefined> {
    const dnsRes = await this.resolveDns(handle)
    if (dnsRes) {
      return dnsRes
    }
    const backupDnsRes = await this.resolveDnsBackup(handle)
    if (backupDnsRes) {
      return backupDnsRes
    }
    return this.resolveHttp(handle)
  }

  async resolveDns(handle: string): Promise<string | undefined> {
    let chunkedResults: string[][]
    try {
      chunkedResults = await dns.resolveTxt(`${SUBDOMAIN}.${handle}`)
    } catch (err) {
      return undefined
    }
    return this.parseDnsResult(chunkedResults)
  }

  async resolveHttp(
    handle: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    let url: URL
    try {
      const scheme =
        this.allowLocalhost && handle.toLowerCase() === 'localhost'
          ? 'http'
          : 'https'
      url = new URL('/.well-known/atproto-did', `${scheme}://${handle}`)
    } catch {
      return undefined
    }

    if (url.username || url.password) {
      return undefined
    }

    if (
      url.protocol !== 'https:' &&
      !(
        this.allowLocalhost &&
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      )
    ) {
      return undefined
    }

    const normalizedHostname = url.hostname.replace(/\.+$/, '')
    try {
      await validateGlobalHost(normalizedHostname, this.allowLocalhost)
    } catch {
      return undefined
    }

    const baseFetch = this.fetch ?? globalThis.fetch
    const fetchFn =
      this.allowLocalhost || (this.fetch && this.fetch !== globalThis.fetch)
        ? baseFetch
        : unicastFetchWrap({ fetch: baseFetch })
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => abortController.abort(), this.timeout)

    let effectiveSignal: AbortSignal
    if (signal) {
      if (typeof AbortSignal.any === 'function') {
        effectiveSignal = AbortSignal.any([signal, abortController.signal])
      } else {
        signal.addEventListener('abort', () => abortController.abort(), {
          once: true,
        })
        effectiveSignal = abortController.signal
      }
    } else {
      effectiveSignal = abortController.signal
    }

    try {
      const res = await fetchFn(url, {
        signal: effectiveSignal,
        redirect: 'error',
      })

      if (!res.ok) return undefined

      const bodyBytes = await readBodyWithLimit(
        res,
        MAX_HANDLE_BODY_SIZE,
        effectiveSignal,
      )
      const text = new TextDecoder().decode(bodyBytes)
      const did = text.split('\n')[0].trim()
      if (typeof did === 'string' && did.startsWith('did:')) {
        return did
      }
      return undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timeoutId)
      abortController.abort()
    }
  }

  async resolveDnsBackup(handle: string): Promise<string | undefined> {
    let chunkedResults: string[][]
    try {
      const backupIps = await this.getBackupNameserverIps()
      if (!backupIps || backupIps.length < 1) return undefined
      const resolver = new dns.Resolver()
      resolver.setServers(backupIps)
      chunkedResults = await resolver.resolveTxt(`${SUBDOMAIN}.${handle}`)
    } catch (err) {
      return undefined
    }
    return this.parseDnsResult(chunkedResults)
  }

  parseDnsResult(chunkedResults: string[][]): string | undefined {
    const results = chunkedResults.map((chunks) => chunks.join(''))
    const didResults = results.filter((result) => result.startsWith(PREFIX))
    if (didResults.length !== 1) {
      return undefined
    }
    const did = didResults[0].slice(PREFIX.length)
    if (typeof did === 'string' && did.startsWith('did:')) {
      return did
    }
    return undefined
  }

  async getBackupNameserverIps(): Promise<string[] | undefined> {
    if (!this.backupNameservers || this.backupNameservers.length === 0) {
      return undefined
    }
    if (!this.backupNameserverIps) {
      const ips = await Promise.all(
        this.backupNameservers.map(async (ns) => {
          if (net.isIP(ns)) {
            return ns
          }
          try {
            const res = await dns.lookup(ns)
            return res.address
          } catch {
            return undefined
          }
        }),
      )
      this.backupNameserverIps = ips.filter(
        (ip): ip is string => typeof ip === 'string',
      )
    }
    return this.backupNameserverIps
  }
}
