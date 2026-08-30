import dns from 'node:dns/promises'
import { HandleResolverOpts } from '../types'

const SUBDOMAIN = '_atproto'
const PREFIX = 'did='
export const MAX_HANDLE_BODY_SIZE = 10 * 1024 // 10 KiB

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
  if (
    normalized.startsWith('[') ||
    normalized.endsWith(']') ||
    normalized.includes(':')
  ) {
    return true
  }
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

export class HandleResolver {
  public timeout: number
  public fetch?: typeof globalThis.fetch
  private backupNameservers: string[] | undefined
  private backupNameserverIps: string[] | undefined

  constructor(opts: HandleResolverOpts = {}) {
    this.timeout = opts.timeout ?? 3000
    this.backupNameservers = opts.backupNameservers
    this.fetch = opts.fetch
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
    if (!this.fetch && isForbiddenHost(handle)) {
      return undefined
    }
    const url = new URL('/.well-known/atproto-did', `https://${handle}`)
    const fetchFn = this.fetch ?? globalThis.fetch
    try {
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), this.timeout)
      const effectiveSignal = signal
        ? AbortSignal.any
          ? AbortSignal.any([signal, abortController.signal])
          : signal
        : abortController.signal

      let res: Response
      try {
        res = await fetchFn(url, {
          signal: effectiveSignal,
          redirect: 'error',
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!res.ok) return undefined

      const buffer = await res.arrayBuffer()
      if (buffer.byteLength > MAX_HANDLE_BODY_SIZE) {
        return undefined
      }

      const text = new TextDecoder().decode(buffer)
      const did = text.split('\n')[0].trim()
      if (typeof did === 'string' && did.startsWith('did:')) {
        return did
      }
      return undefined
    } catch (err) {
      return undefined
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
    const found = results.filter((i) => i.startsWith(PREFIX))
    if (found.length !== 1) {
      return undefined
    }
    return found[0].slice(PREFIX.length)
  }

  private async getBackupNameserverIps(): Promise<string[] | undefined> {
    if (!this.backupNameservers) {
      return undefined
    } else if (!this.backupNameserverIps) {
      const responses = await Promise.allSettled(
        this.backupNameservers.map((h) => dns.lookup(h)),
      )
      for (const res of responses) {
        if (res.status === 'fulfilled') {
          this.backupNameserverIps ??= []
          this.backupNameserverIps.push(res.value.address)
        }
      }
    }
    return this.backupNameserverIps
  }
}
