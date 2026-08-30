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

    it('rejects oversized handle HTTP fallback bodies (> 10 KiB)', async () => {
      const oversizedBody = 'did:example:tooLong' + 'A'.repeat(15 * 1024)
      const mockFetch: typeof fetch = async () => {
        return new Response(oversizedBody, { status: 200 })
      }
      const testResolver = new HandleResolver({ fetch: mockFetch })
      const did = await testResolver.resolve('bad.test')
      expect(did).toBeUndefined()
    })
  })
})
