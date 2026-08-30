import nodeDns from 'node:dns'
import dns from 'node:dns/promises'
import * as plc from '@did-plc/lib'
import { Database as DidPlcDb, PlcServer } from '@did-plc/server'
import getPort from 'get-port'
import { Secp256k1Keypair } from '@atproto/crypto'
import { DidDocument, DidResolver } from '../src'
import { DidWebDb } from './web/db'
import { DidWebServer } from './web/server'

describe('did resolver', () => {
  let close: () => Promise<void>
  let webServer: DidWebServer
  let plcUrl: string
  let resolver: DidResolver

  beforeAll(async () => {
    const webDb = DidWebDb.memory()
    webServer = DidWebServer.create(webDb, await getPort())
    await new Promise((resolve, reject) => {
      webServer._httpServer?.on('listening', resolve)
      webServer._httpServer?.on('error', reject)
    })

    const plcDB = DidPlcDb.mock()
    const plcPort = await getPort()
    const plcServer = PlcServer.create({ db: plcDB, port: plcPort })
    await plcServer.start()

    plcUrl = 'http://localhost:' + plcPort
    resolver = new DidResolver({ plcUrl, allowLocalhost: true })

    close = async () => {
      await webServer.close()
      await plcServer.destroy()
    }
  })

  afterAll(async () => {
    await close()
  })

  const handle = 'alice.test'
  const pds = 'https://service.test'
  let signingKey: Secp256k1Keypair
  let rotationKey: Secp256k1Keypair
  let webDid: string
  let plcDid: string
  let didWebDoc: DidDocument
  let didPlcDoc: DidDocument

  it('creates the did on did:web & did:plc', async () => {
    signingKey = await Secp256k1Keypair.create()
    rotationKey = await Secp256k1Keypair.create()
    const client = new plc.Client(plcUrl)
    plcDid = await client.createDid({
      signingKey: signingKey.did(),
      handle,
      pds,
      rotationKeys: [rotationKey.did()],
      signer: rotationKey,
    })
    didPlcDoc = await client.getDocument(plcDid)
    const domain = encodeURIComponent(`localhost:${webServer.port}`)
    webDid = `did:web:${domain}`
    didWebDoc = {
      ...didPlcDoc,
      id: webDid,
    }

    await webServer.put(didWebDoc)
  })

  it('resolve valid did:web', async () => {
    const didRes = await resolver.ensureResolve(webDid)
    expect(didRes).toEqual(didWebDoc)
  })

  it('resolve valid atpData from did:web', async () => {
    const atpData = await resolver.resolveAtprotoData(webDid)
    expect(atpData.did).toEqual(webDid)
    expect(atpData.handle).toEqual(handle)
    expect(atpData.pds).toEqual(pds)
    expect(atpData.signingKey).toEqual(signingKey.did())
    expect(atpData.handle).toEqual(handle)
  })

  it('throws on malformed did:webs', async () => {
    await expect(resolver.ensureResolve(`did:web:asdf`)).rejects.toThrow()
    await expect(resolver.ensureResolve(`did:web:`)).rejects.toThrow()
    await expect(resolver.ensureResolve(``)).rejects.toThrow()
  })

  it('throws on did:web with path components', async () => {
    await expect(
      resolver.ensureResolve(`did:web:example.com:u:bob`),
    ).rejects.toThrow()
  })

  it('resolve valid did:plc', async () => {
    const didRes = await resolver.ensureResolve(plcDid)
    expect(didRes).toEqual(didPlcDoc)
  })

  it('resolve valid atpData from did:plc', async () => {
    const atpData = await resolver.resolveAtprotoData(plcDid)
    expect(atpData.did).toEqual(plcDid)
    expect(atpData.handle).toEqual(handle)
    expect(atpData.pds).toEqual(pds)
    expect(atpData.signingKey).toEqual(signingKey.did())
    expect(atpData.handle).toEqual(handle)
  })

  it('throws on malformed did:plc', async () => {
    await expect(resolver.ensureResolve(`did:plc:asdf`)).rejects.toThrow()
    await expect(resolver.ensureResolve(`did:plc`)).rejects.toThrow()
  })

  describe('safe-fetch and security bounds', () => {
    it('rejects encoded did:web paths and directory traversal attempts', async () => {
      await expect(
        resolver.ensureResolve('did:web:example.com%2Fpath'),
      ).rejects.toThrow('Unsupported did:web paths')
      await expect(
        resolver.ensureResolve('did:web:example.com%2fpath'),
      ).rejects.toThrow('Unsupported did:web paths')
      await expect(
        resolver.ensureResolve('did:web:example.com%2F..%2Fetc'),
      ).rejects.toThrow('Unsupported did:web paths')
      await expect(
        resolver.ensureResolve('did:web:example.com%5Cpath'),
      ).rejects.toThrow('Unsupported did:web paths')
    })

    it('rejects loopback, private, and link-local addresses without making network calls', async () => {
      let fetchCalled = false
      const countingFetch: typeof fetch = async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }
      const testResolver = new DidResolver({ fetch: countingFetch })
      await expect(
        testResolver.resolve('did:web:127.0.0.1'),
      ).rejects.toThrow('Forbidden hostname "127.0.0.1"')
      await expect(
        testResolver.resolve('did:web:127.0.0.1.'),
      ).rejects.toThrow('Forbidden hostname')
      await expect(
        testResolver.resolve('did:web:10.0.0.1'),
      ).rejects.toThrow('Forbidden hostname "10.0.0.1"')
      await expect(
        testResolver.resolve('did:web:100.64.0.1'),
      ).rejects.toThrow('Forbidden hostname "100.64.0.1"')
      await expect(
        testResolver.resolve('did:web:169.254.169.254'),
      ).rejects.toThrow('Forbidden hostname "169.254.169.254"')
      await expect(
        testResolver.resolve('did:web:fe8a::1'),
      ).rejects.toThrow()
      await expect(
        testResolver.resolve('did:web:%5Bfe8a%3A%3A1%5D'),
      ).rejects.toThrow('Forbidden hostname')
      await expect(
        testResolver.resolve('did:web:%5B%3A%3Affff%3A127.0.0.1%5D'),
      ).rejects.toThrow('Forbidden hostname')
      await expect(
        testResolver.resolve('did:web:%5B%3A%3Affff%3A7f00%3A1%5D'),
      ).rejects.toThrow('Forbidden hostname')
      expect(fetchCalled).toBe(false)
    })

    it('rejects URL userinfo (@) and SSRF bypass attempts without making network calls', async () => {
      let fetchCalled = false
      const countingFetch: typeof fetch = async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }
      const testResolver = new DidResolver({ fetch: countingFetch })
      await expect(
        testResolver.resolve('did:web:foo%40169.254.169.254'),
      ).rejects.toThrow()
      await expect(
        testResolver.resolve('did:web:foo%40localhost'),
      ).rejects.toThrow()
      expect(fetchCalled).toBe(false)
    })

    it('rejects DNS rebinding / hostnames resolving to private IP addresses', async () => {
      let fetchCalled = false
      const countingFetch: typeof fetch = async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }
      const testResolver = new DidResolver({ fetch: countingFetch })
      // localhost is blocked by both hostname and DNS resolution check
      await expect(
        testResolver.resolve('did:web:localhost'),
      ).rejects.toThrow('Forbidden hostname "localhost"')

      // Mock DNS lookup to return a private IP for a non-denylisted hostname
      const lookupSpy = jest
        .spyOn(dns, 'lookup')
        .mockResolvedValueOnce([
          { address: '100.64.0.1', family: 4 },
        ] as unknown as Awaited<ReturnType<typeof dns.lookup>>)

      try {
        await expect(
          testResolver.resolve('did:web:rebind.example.com'),
        ).rejects.toThrow(
          'Forbidden IP address "100.64.0.1" for host "rebind.example.com"',
        )
      } finally {
        lookupSpy.mockRestore()
      }
      expect(fetchCalled).toBe(false)
    })
    it('fails closed on attacker-inducible resolver errors (EAI_AGAIN) with zero outbound fetch calls', async () => {
      let fetchCalled = false
      const countingFetch: typeof fetch = async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }
      const testResolver = new DidResolver({ fetch: countingFetch })

      const eaiAgainErr = Object.assign(new Error('getaddrinfo EAI_AGAIN'), {
        code: 'EAI_AGAIN',
      })
      const lookupSpy = jest
        .spyOn(dns, 'lookup')
        .mockRejectedValueOnce(eaiAgainErr)

      try {
        await expect(
          testResolver.resolve('did:web:unverifiable.example.com'),
        ).rejects.toThrow('getaddrinfo EAI_AGAIN')
      } finally {
        lookupSpy.mockRestore()
      }
      expect(fetchCalled).toBe(false)
    })
    it('prevents DNS rebinding with divergent resolutions between preflight and connect time', async () => {
      const testResolver = new DidResolver()

      // Preflight DNS returns public IP (preflight check passes)
      const preflightLookupSpy = jest
        .spyOn(dns, 'lookup')
        .mockResolvedValueOnce([
          { address: '93.184.216.34', family: 4 },
        ] as unknown as nodeDns.LookupAddress)

      // Connect-time DNS in unicastLookup returns private IP (DNS rebinding)
      const origNodeDnsLookup = nodeDns.lookup
      const nodeDnsLookupSpy = jest
        .spyOn(nodeDns, 'lookup')
        .mockImplementation(((
          hostname: string,
          options: unknown,
          callback?: unknown,
        ) => {
          let cb = callback as
            | ((
                err: NodeJS.ErrnoException | null,
                addresses: nodeDns.LookupAddress[],
              ) => void)
            | undefined
          let opts = options
          if (typeof options === 'function') {
            cb = options as typeof cb
            opts = {}
          }
          if (hostname === 'rebind-divergent.customdomain.org') {
            cb?.(null, [{ address: '127.0.0.1', family: 4 }])
            return
          }
          return (origNodeDnsLookup as Function)(hostname, opts, cb)
        }) as typeof nodeDns.lookup)

      try {
        let thrownError: (Error & { cause?: Error }) | undefined
        try {
          await testResolver.resolve('did:web:rebind-divergent.customdomain.org')
        } catch (err: unknown) {
          thrownError = err as Error & { cause?: Error }
        }
        expect(thrownError).toBeDefined()
        expect(thrownError?.cause?.message).toBe(
          'Hostname resolved to non-unicast address',
        )
      } finally {
        preflightLookupSpy.mockRestore()
        nodeDnsLookupSpy.mockRestore()
      }
    })


    it('rejects HTTP redirects (redirect: error) and does not follow location', async () => {
      let callCount = 0
      const redirectFetch: typeof fetch = async (_input, init) => {
        callCount++
        expect(init?.redirect).toBe('error')
        if (init?.redirect === 'error') {
          throw new TypeError('Failed to fetch: redirect mode is error')
        }
        return new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/.well-known/did.json' },
        })
      }
      const testResolver = new DidResolver({
        fetch: redirectFetch,
        allowLocalhost: true,
      })
      await expect(
        testResolver.resolve('did:web:localhost'),
      ).rejects.toThrow('Failed to fetch: redirect mode is error')
      expect(callCount).toBe(1)
    })

    it('allows global hosts with custom ports', async () => {
      let requestedUrl = ''
      const mockFetch: typeof fetch = async (input) => {
        requestedUrl = input.toString()
        return new Response(
          JSON.stringify({
            id: 'did:web:example.com%3A8443',
            verificationMethod: [],
          }),
          { status: 200 },
        )
      }
      const testResolver = new DidResolver({ fetch: mockFetch })
      const doc = await testResolver.resolve('did:web:example.com%3A8443')
      expect(doc).toBeDefined()
      expect(requestedUrl).toBe('https://example.com:8443/.well-known/did.json')
    })

    it('times out and rejects hanging fetch requests (3 s limit)', async () => {
      const hangingFetch: typeof fetch = (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'))
          })
        })
      }
      const testResolver = new DidResolver({
        timeout: 50,
        fetch: hangingFetch,
        allowLocalhost: true,
      })
      await expect(
        testResolver.resolve('did:web:localhost'),
      ).rejects.toThrow('The operation was aborted')
    })

    it('rejects oversized DID documents (> 64 KiB) before buffering entire stream', async () => {
      let streamCancelled = false
      const oversizedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(32 * 1024))
          controller.enqueue(new Uint8Array(40 * 1024))
        },
        cancel() {
          streamCancelled = true
        },
      })
      const mockFetch: typeof fetch = async () => {
        return new Response(oversizedStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const resolverWithMock = new DidResolver({
        fetch: mockFetch,
        allowLocalhost: true,
      })
      await expect(
        resolverWithMock.resolve('did:web:localhost'),
      ).rejects.toThrow('Response size exceeds limit (65536 bytes)')
      expect(streamCancelled).toBe(true)
    })
  })
})
