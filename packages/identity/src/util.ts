import dns from 'node:dns/promises'

export function isForbiddenHost(host: string): boolean {
  const normalized = host.toLowerCase()
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
  // IPv6 literal (bracketed or raw colon without leading host part)
  if (
    normalized.startsWith('[') ||
    normalized.endsWith(']') ||
    normalized.includes('::') ||
    (normalized.includes(':') && !/^[a-z0-9.-]+:\d+$/.test(normalized))
  ) {
    return true
  }
  // Custom port on non-localhost hostname is forbidden
  if (normalized.includes(':')) {
    const [hostnamePart] = normalized.split(':')
    if (hostnamePart !== 'localhost') {
      return true
    }
  }
  // IPv4 literal: 0.0.0.0/8, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, >=224 (multicast/broadcast)
  const hostWithoutPort = normalized.split(':')[0]
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostWithoutPort)) {
    const parts = hostWithoutPort.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a >= 224) return true
  }
  return false
}

export function isPrivateIp(ip: string): boolean {
  // IPv4 check
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a >= 224) return true
    return false
  }

  // IPv6 check: loopback ::1, unspecified ::, IPv4-mapped, ULA fc00::/7, link-local fe80::/10
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7)
    return isPrivateIp(v4Part)
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fe90:') ||
    normalized.startsWith('fea0:') ||
    normalized.startsWith('feb0:')
  ) {
    return true
  }

  return false
}

export async function validateGlobalHost(
  hostname: string,
  allowLocalhost = false,
): Promise<void> {
  const normalized = hostname.toLowerCase()
  if (
    allowLocalhost &&
    (normalized === 'localhost' || normalized.startsWith('localhost:'))
  ) {
    return
  }

  if (isForbiddenHost(hostname)) {
    throw new Error(`Forbidden hostname "${hostname}"`)
  }

  // Resolve DNS to verify IP addresses are not private/loopback/link-local (DNS rebinding / private resolution protection)
  const hostToResolve = normalized.split(':')[0]
  try {
    const addresses = await dns.lookup(hostToResolve, { all: true })
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        throw new Error(
          `Forbidden IP address "${record.address}" for host "${hostname}"`,
        )
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes('Forbidden IP address') ||
        err.message.includes('Forbidden hostname'))
    ) {
      throw err
    }
    // DNS resolution failure (e.g. NXDOMAIN) will be caught during fetch or handled by caller
  }
}

export async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
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

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
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
