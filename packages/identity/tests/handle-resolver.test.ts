import { HandleResolver } from '../src'

jest.mock('node:dns/promises', () => {
  return {
    resolveTxt: (handle: string) => {
      if (handle === '_atproto.simple.test') {
        return [['did=did:example:simpleDid']]
      }
      if (handle === '_atproto.noisy.test') {
        return [
          ['blah blah blah'],
          ['did:example:fakeDid'],
          ['atproto=did:example:fakeDid'],
          ['did=did:example:noisyDid'],
          [
            'chunk long domain aspdfoiuwerpoaisdfupasodfiuaspdfoiuasdpfoiausdfpaosidfuaspodifuaspdfoiuasdpfoiasudfpasodifuaspdofiuaspdfoiuasd',
            'apsodfiuweproiasudfpoasidfu',
          ],
        ]
      }
      if (handle === '_atproto.bad.test') {
        return [
          ['blah blah blah'],
          ['did:example:fakeDid'],
          ['atproto=did:example:fakeDid'],
          [
            'chunk long domain aspdfoiuwerpoaisdfupasodfiuaspdfoiuasdpfoiausdfpaosidfuaspodifuaspdfoiuasdpfoiasudfpasodifuaspdofiuaspdfoiuasd',
            'apsodfiuweproiasudfpoasidfu',
          ],
        ]
      }
      if (handle === '_atproto.multi.test') {
        return [['did=did:example:firstDid'], ['did=did:example:secondDid']]
      }
    },
  }
})

describe('handle resolver', () => {
  let resolver: HandleResolver

  beforeAll(async () => {
    resolver = new HandleResolver()
  })

  it('handles a simple DNS resolution', async () => {
    const did = await resolver.resolveDns('simple.test')
    expect(did).toBe('did:example:simpleDid')
  })

  it('handles a noisy DNS resolution', async () => {
    const did = await resolver.resolveDns('noisy.test')
    expect(did).toBe('did:example:noisyDid')
  })

  it('handles a bad DNS resolution', async () => {
    const did = await resolver.resolveDns('bad.test')
    expect(did).toBeUndefined()
  })

  it('throws on multiple dids under same domain', async () => {
    const did = await resolver.resolveDns('multi.test')
    expect(did).toBeUndefined()
  })

  describe('DNS-first and safe-fetch fallback', () => {
    it('resolves DNS first without initiating speculative HTTP fallback', async () => {
      let httpCalled = false
      const mockFetch: typeof fetch = async () => {
        httpCalled = true
        return new Response('did:example:httpDid', { status: 200 })
      }
      const testResolver = new HandleResolver({ fetch: mockFetch })
      const did = await testResolver.resolve('simple.test')
      expect(did).toBe('did:example:simpleDid')
      expect(httpCalled).toBe(false)
    })

    it('falls back to HTTP only when DNS resolution fails', async () => {
      let httpCalled = false
      const mockFetch: typeof fetch = async () => {
        httpCalled = true
        return new Response('did:example:httpFallbackDid', { status: 200 })
      }
      const testResolver = new HandleResolver({ fetch: mockFetch })
      const did = await testResolver.resolve('bad.test')
      expect(httpCalled).toBe(true)
      expect(did).toBe('did:example:httpFallbackDid')
    })

    it('rejects forbidden and private hosts in handle HTTP fallback without fetching', async () => {
      let httpCalled = false
      const mockFetch: typeof fetch = async () => {
        httpCalled = true
        return new Response('did:example:httpFallbackDid', { status: 200 })
      }
      const testResolver = new HandleResolver({ fetch: mockFetch })
      expect(await testResolver.resolveHttp('127.0.0.1')).toBeUndefined()
      expect(await testResolver.resolveHttp('10.0.0.1')).toBeUndefined()
      expect(await testResolver.resolveHttp('localhost')).toBeUndefined()
      expect(await testResolver.resolveHttp('internal.lan')).toBeUndefined()
      expect(httpCalled).toBe(false)
    })

    it('times out and returns undefined on hanging HTTP fallback', async () => {
      const hangingFetch: typeof fetch = (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'))
          })
        })
      }
      const testResolver = new HandleResolver({
        timeout: 50,
        fetch: hangingFetch,
        allowLocalhost: true,
      })
      const did = await testResolver.resolveHttp('localhost')
      expect(did).toBeUndefined()
    })

    it('rejects oversized handle HTTP fallback bodies (> 10 KiB) and cancels stream', async () => {
      let streamCancelled = false
      const oversizedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(6 * 1024))
          controller.enqueue(new Uint8Array(6 * 1024))
        },
        cancel() {
          streamCancelled = true
        },
      })
      const mockFetch: typeof fetch = async () => {
        return new Response(oversizedStream, { status: 200 })
      }
      const testResolver = new HandleResolver({
        fetch: mockFetch,
        allowLocalhost: true,
      })
      const did = await testResolver.resolveHttp('localhost')
      expect(did).toBeUndefined()
      expect(streamCancelled).toBe(true)
    })
  })
})
