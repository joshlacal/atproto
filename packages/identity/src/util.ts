import dns from 'node:dns/promises'
import { ForbiddenHostError, ForbiddenIpError } from './errors'

function isForbiddenIpv4Octets(
  a: number,
  b: number,
  c: number,
  _d: number,
): boolean {
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true // 224.0.0.0/4 multicast + reserved/broadcast
  return false
}

export function isForbiddenHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.+$/, '')
  if (
    normalized === 'localhost' ||
    normalized.startsWith('localhost:') ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.invalid')
  ) {
    return true
  }
  // IPv6 literal (bracketed or raw colon without valid domain:port syntax)
  if (
    normalized.startsWith('[') ||
    normalized.endsWith(']') ||
    normalized.includes('::') ||
    (normalized.includes(':') && !/^[a-z0-9.-]+:\d+$/.test(normalized))
  ) {
    return true
  }

  // IPv4 literal: check the host part without port
  const hostWithoutPort = normalized.split(':')[0]
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostWithoutPort)) {
    const parts = hostWithoutPort.split('.').map(Number)
    const [a, b, c, d] = parts
    return isForbiddenIpv4Octets(a, b, c, d)
  }
  return false
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/\.+$/, '')
  // IPv4 check
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(normalized)) {
    const parts = normalized.split('.').map(Number)
    const [a, b, c, d] = parts
    return isForbiddenIpv4Octets(a, b, c, d)
  }

  // IPv6 check
  // Unspecified :: or loopback ::1
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '0:0:0:0:0:0:0:0'
  ) {
    return true
  }

  // IPv4-mapped IPv6 (dotted or hex)
  if (normalized.startsWith('::ffff:')) {
    const rest = normalized.slice(7)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(rest)) {
      const parts = rest.split('.').map(Number)
      return isForbiddenIpv4Octets(parts[0], parts[1], parts[2], parts[3])
    }
    const hexParts = rest.split(':')
    if (hexParts.length === 2) {
      const h1 = parseInt(hexParts[0], 16)
      const h2 = parseInt(hexParts[1], 16)
      if (!isNaN(h1) && !isNaN(h2)) {
        const a = (h1 >> 8) & 0xff
        const b = h1 & 0xff
        const c = (h2 >> 8) & 0xff
        const d = h2 & 0xff
        return isForbiddenIpv4Octets(a, b, c, d)
      }
    }
    return true
  }

  // Check IPv6 first hextet
  const firstHextetStr = normalized.split(':')[0]
  if (firstHextetStr) {
    const firstHextet = parseInt(firstHextetStr, 16)
    if (!isNaN(firstHextet)) {
      // ULA: fc00::/7 (fc00:: - fdff::)
      if ((firstHextet & 0xfe00) === 0xfc00) return true
      // Link-local: fe80::/10 (fe80:: - febf::)
      if ((firstHextet & 0xffc0) === 0xfe80) return true
      // Deprecated site-local: fec0::/10 (fec0:: - feff::)
      if ((firstHextet & 0xffc0) === 0xfec0) return true
      // Multicast: ff00::/8
      if ((firstHextet & 0xff00) === 0xff00) return true
    }
  }

  return false
}

export async function validateGlobalHost(
  hostname: string,
  allowLocalhost = false,
): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/\.+$/, '')
  if (
    allowLocalhost &&
    (normalized === 'localhost' || normalized.startsWith('localhost:'))
  ) {
    return
  }

  if (isForbiddenHost(normalized)) {
    throw new ForbiddenHostError(hostname)
  }

  // Resolve DNS to verify IP addresses are not private/loopback/link-local (DNS rebinding / private resolution protection)
  const hostToResolve = normalized.split(':')[0]
  try {
    const addresses = await dns.lookup(hostToResolve, { all: true })
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        throw new ForbiddenIpError(record.address, hostname)
      }
    }
  } catch (err: unknown) {
    if (err instanceof ForbiddenHostError) {
      throw err
    }
    const code = (err as { code?: string })?.code
    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'ENODATA' ||
      code === 'ESERVFAIL'
    ) {
      return
    }
    throw err
  }
}

export async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = res.headers.get('content-length')
  if (contentLength) {
    const parsed = parseInt(contentLength, 10)
    if (!isNaN(parsed) && parsed > maxBytes) {
      throw new Error(`Response size exceeds limit (${maxBytes} bytes)`)
    }
  }

  if (!res.body) {
    return new Uint8Array(0)
  }

  if (signal?.aborted) {
    throw new Error('The operation was aborted')
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  let onAbort: (() => void) | undefined
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => {
          reader.cancel().catch(() => {})
          reject(new Error('The operation was aborted'))
        }
        if (signal.aborted) {
          onAbort()
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    : undefined

  try {
    while (true) {
      const readPromise = reader.read()
      const { done, value } = abortPromise
        ? await Promise.race([readPromise, abortPromise])
        : await readPromise
      if (done) break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          await reader.cancel()
          throw new Error(`Response size exceeds limit (${maxBytes} bytes)`)
        }
        chunks.push(value)
      }
    }
  } finally {
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
    reader.releaseLock?.()
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
