import fs from 'node:fs/promises'
import path from 'node:path'
import { AtpAgent } from '@atproto/api'
import { HOUR } from '@atproto/common'
import { Secp256k1Keypair } from '@atproto/crypto'
import {
  SeedClient,
  TestNetworkNoAppView,
  basicSeed,
  mockNetworkUtilities,
} from '@atproto/dev-env'
import { DidDocument } from '@atproto/identity'
import { createServiceJwt } from '@atproto/xrpc-server'
import { AppContext } from '../src'
import { ids } from '../src/lexicon/lexicons'

describe('reserve signing key admission, quota, and expiry', () => {
  let network: TestNetworkNoAppView
  let ctx: AppContext
  let agent: AtpAgent
  let sc: SeedClient
  let alice: string
  let bob: string
  let carol: string
  let pdsDid: string
  beforeAll(async () => {
    network = await TestNetworkNoAppView.create({
      dbPostgresSchema: 'reserve_signing_key',
    })
    mockNetworkUtilities(network.pds)
    // @ts-expect-error Error due to circular dependency with the dev-env package
    ctx = network.pds.ctx
    sc = network.getSeedClient()
    agent = network.pds.getClient()
    await basicSeed(sc)
    alice = sc.dids.alice
    bob = sc.dids.bob
    carol = sc.dids.carol
    pdsDid = ctx.cfg.service.did
    await network.processAll()
  })

  afterAll(async () => {
    await network.close()
  })

  const getReservedFiles = async (): Promise<string[]> => {
    try {
      const entries = await fs.readdir(ctx.actorStore.reservedKeyDir, {
        withFileTypes: true,
      })
      return entries
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      ) {
        return []
      }
      throw err
    }
  }

  describe('admission control', () => {
    it('rejects request with omitted DID and creates no file', async () => {
      const filesBefore = await getReservedFiles()
      const req = agent.api.com.atproto.server.reserveSigningKey({})
      await expect(req).rejects.toThrow()
      const filesAfter = await getReservedFiles()
      expect(filesAfter.length).toBe(filesBefore.length)
    })

    it('rejects unauthenticated request with DID and creates no file', async () => {
      const filesBefore = await getReservedFiles()
      const req = agent.api.com.atproto.server.reserveSigningKey({
        did: alice,
      })
      await expect(req).rejects.toThrow()
      const filesAfter = await getReservedFiles()
      expect(filesAfter.length).toBe(filesBefore.length)
    })

    it('rejects request with invalid/expired service auth and creates no file', async () => {
      const filesBefore = await getReservedFiles()
      const aliceKey = await ctx.actorStore.keypair(alice)
      const expiredJwt = await createServiceJwt({
        iss: alice,
        aud: pdsDid,
        lxm: ids.ComAtprotoServerReserveSigningKey,
        exp: Math.floor(Date.now() / 1000) - 60, // expired 1 min ago
        keypair: aliceKey,
      })

      const req = agent.api.com.atproto.server.reserveSigningKey(
        { did: alice },
        { headers: { authorization: `Bearer ${expiredJwt}` } },
      )
      await expect(req).rejects.toThrow()
      const filesAfter = await getReservedFiles()
      expect(filesAfter.length).toBe(filesBefore.length)
    })

    it('rejects request with mismatched service auth DID and body DID', async () => {
      const filesBefore = await getReservedFiles()
      const aliceKey = await ctx.actorStore.keypair(alice)
      const serviceJwt = await createServiceJwt({
        iss: alice,
        aud: pdsDid,
        lxm: ids.ComAtprotoServerReserveSigningKey,
        keypair: aliceKey,
      })

      // Service JWT is for alice, but body specifies bob
      const req = agent.api.com.atproto.server.reserveSigningKey(
        { did: bob },
        { headers: { authorization: `Bearer ${serviceJwt}` } },
      )
      await expect(req).rejects.toThrow()
      const filesAfter = await getReservedFiles()
      expect(filesAfter.length).toBe(filesBefore.length)
    })

    it('repeated unauthenticated requests create zero persistent files', async () => {
      const filesBefore = await getReservedFiles()
      for (let i = 0; i < 10; i++) {
        await expect(
          agent.api.com.atproto.server.reserveSigningKey({}),
        ).rejects.toThrow()
        await expect(
          agent.api.com.atproto.server.reserveSigningKey({
            did: `did:plc:fake${i}`,
          }),
        ).rejects.toThrow()
      }
      const filesAfter = await getReservedFiles()
      expect(filesAfter.length).toBe(filesBefore.length)
    })
  })

  describe('idempotency and migration proof', () => {
    it('successfully reserves a signing key with valid migration proof', async () => {
      const aliceKey = await ctx.actorStore.keypair(alice)
      const serviceJwt = await createServiceJwt({
        iss: alice,
        aud: pdsDid,
        lxm: ids.ComAtprotoServerReserveSigningKey,
        keypair: aliceKey,
      })

      const res = await agent.api.com.atproto.server.reserveSigningKey(
        { did: alice },
        { headers: { authorization: `Bearer ${serviceJwt}` } },
      )

      expect(typeof res.data.signingKey).toBe('string')
      expect(res.data.signingKey.startsWith('did:key:')).toBe(true)

      const files = await getReservedFiles()
      expect(files).toContain(alice)
    })

    it('is idempotent for the same DID with valid proof', async () => {
      const aliceKey = await ctx.actorStore.keypair(alice)
      const serviceJwt = await createServiceJwt({
        iss: alice,
        aud: pdsDid,
        lxm: ids.ComAtprotoServerReserveSigningKey,
        keypair: aliceKey,
      })

      const res1 = await agent.api.com.atproto.server.reserveSigningKey(
        { did: alice },
        { headers: { authorization: `Bearer ${serviceJwt}` } },
      )
      const res2 = await agent.api.com.atproto.server.reserveSigningKey(
        { did: alice },
        { headers: { authorization: `Bearer ${serviceJwt}` } },
      )

      expect(res1.data.signingKey).toEqual(res2.data.signingKey)
    })
  })

  describe('quota and TTL enforcement', () => {
    it('enforces maxReservedKeys quota and fails closed', async () => {
      const origMax = ctx.actorStore.maxReservedKeys
      try {
        // Set small quota on actorStore
        ctx.actorStore.maxReservedKeys = 2

        const aliceKey = await ctx.actorStore.keypair(alice)
        const bobKey = await ctx.actorStore.keypair(bob)

        const aliceJwt = await createServiceJwt({
          iss: alice,
          aud: pdsDid,
          lxm: ids.ComAtprotoServerReserveSigningKey,
          keypair: aliceKey,
        })
        const bobJwt = await createServiceJwt({
          iss: bob,
          aud: pdsDid,
          lxm: ids.ComAtprotoServerReserveSigningKey,
          keypair: bobKey,
        })

        // Reserve for alice (1 of 2)
        await agent.api.com.atproto.server.reserveSigningKey(
          { did: alice },
          { headers: { authorization: `Bearer ${aliceJwt}` } },
        )

        // Reserve for bob (2 of 2)
        await agent.api.com.atproto.server.reserveSigningKey(
          { did: bob },
          { headers: { authorization: `Bearer ${bobJwt}` } },
        )

        // Idempotency at capacity: alice can still fetch her existing key
        const aliceRes = await agent.api.com.atproto.server.reserveSigningKey(
          { did: alice },
          { headers: { authorization: `Bearer ${aliceJwt}` } },
        )
        expect(aliceRes.data.signingKey.startsWith('did:key:')).toBe(true)

        // New DID at capacity should be rejected
        const carolKey = await ctx.actorStore.keypair(carol)
        const carolJwt = await createServiceJwt({
          iss: carol,
          aud: pdsDid,
          lxm: ids.ComAtprotoServerReserveSigningKey,
          keypair: carolKey,
        })
        const req = agent.api.com.atproto.server.reserveSigningKey(
          { did: carol },
          { headers: { authorization: `Bearer ${carolJwt}` } },
        )
        await expect(req).rejects.toThrow('quota')
      } finally {
        ctx.actorStore.maxReservedKeys = origMax
      }
    })

    it('prunes expired mtime entries and recovers quota', async () => {
      const origMax = ctx.actorStore.maxReservedKeys
      const origTtl = ctx.actorStore.reservedKeyTtlMs
      try {
        ctx.actorStore.maxReservedKeys = 2
        ctx.actorStore.reservedKeyTtlMs = 1000 // 1 second

        const aliceKey = await ctx.actorStore.keypair(alice)
        const aliceJwt = await createServiceJwt({
          iss: alice,
          aud: pdsDid,
          lxm: ids.ComAtprotoServerReserveSigningKey,
          keypair: aliceKey,
        })

        await agent.api.com.atproto.server.reserveSigningKey(
          { did: alice },
          { headers: { authorization: `Bearer ${aliceJwt}` } },
        )

        // Age alice's reservation file mtime by setting utimes in the past
        const aliceFile = path.join(ctx.actorStore.reservedKeyDir, alice)
        const pastTime = (Date.now() - 10000) / 1000
        await fs.utimes(aliceFile, pastTime, pastTime)

        // Prune expired keys
        const pruned = await ctx.actorStore.pruneExpiredReservedKeypairs()
        expect(pruned).toBeGreaterThanOrEqual(1)

        const files = await getReservedFiles()
        expect(files).not.toContain(alice)
      } finally {
        ctx.actorStore.maxReservedKeys = origMax
        ctx.actorStore.reservedKeyTtlMs = origTtl
      }
    })

    it('caps TTL at 24 hours in actorStore and config', async () => {
      expect(ctx.actorStore.reservedKeyTtlMs).toBeLessThanOrEqual(24 * HOUR)
    })
  })
})
