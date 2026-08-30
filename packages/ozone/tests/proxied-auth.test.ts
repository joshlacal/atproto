import { Secp256k1Keypair } from '@atproto/crypto'
import { createServiceJwt } from '@atproto/xrpc-server'
import {
  ADMIN_PASSWORD,
  DidAndKey,
  SeedClient,
  TestNetwork,
  basicSeed,
  createDidAndKey,
} from '@atproto/dev-env'
import { ids } from '../src/lexicon/lexicons'
import { parseJwtPayload } from '../src/auth-verifier'

describe('proxied authorization matrix (F16, F26)', () => {
  let network: TestNetwork
  let sc: SeedClient

  let adminUser: DidAndKey
  let modUser: DidAndKey
  let triageUser: DidAndKey
  let verifierUser: DidAndKey
  let disabledUser: DidAndKey

  const createAuthHeader = async (
    user: DidAndKey,
    lxm: string,
  ) => {
    const jwt = await createServiceJwt({
      iss: user.did,
      aud: network.ozone.ctx.cfg.service.did,
      lxm,
      keypair: user.key,
    })
    return { authorization: `Bearer ${jwt}` }
  }

  const basicAdminAuthHeader = () => ({
    authorization: `Basic ${Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64')}`,
  })

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'ozone_proxied_auth',
    })
    sc = network.getSeedClient()
    await basicSeed(sc)

    adminUser = network.ozone.adminAccnt
    modUser = network.ozone.moderatorAccnt
    triageUser = network.ozone.triageAccnt

    verifierUser = await createDidAndKey({
      plcUrl: network.plc.url,
      handle: 'verifier.ozone',
      pds: network.pds.url,
    })
    await network.ozone.ctx.teamService(network.ozone.ctx.db).create({
      did: verifierUser.did,
      disabled: false,
      handle: 'verifier.ozone',
      displayName: 'Dan Verifier',
      lastUpdatedBy: network.ozone.ctx.cfg.service.did,
      role: 'tools.ozone.team.defs#roleVerifier',
    })

    disabledUser = await createDidAndKey({
      plcUrl: network.plc.url,
      handle: 'disabled.ozone',
      pds: network.pds.url,
    })
    await network.ozone.ctx.teamService(network.ozone.ctx.db).create({
      did: disabledUser.did,
      disabled: true,
      handle: 'disabled.ozone',
      displayName: 'Eve Disabled',
      lastUpdatedBy: network.ozone.ctx.cfg.service.did,
      role: 'tools.ozone.team.defs#roleModerator',
    })

    // Mock downstream PDS calls
    if (network.ozone.ctx.pdsAgent) {
      jest
        .spyOn(
          network.ozone.ctx.pdsAgent.tools.ozone.hosting,
          'getAccountHistory',
        )
        .mockResolvedValue({
          success: true,
          headers: {},
          data: { cursor: undefined, events: [] },
        })
      jest
        .spyOn(network.ozone.ctx.pdsAgent.com.atproto.admin, 'searchAccounts')
        .mockResolvedValue({
          success: true,
          headers: {},
          data: { cursor: undefined, accounts: [] },
        })
      jest
        .spyOn(
          network.ozone.ctx.pdsAgent.tools.ozone.signature,
          'findRelatedAccounts',
        )
        .mockResolvedValue({
          success: true,
          headers: {},
          data: { cursor: undefined, accounts: [] },
        })
      jest
        .spyOn(
          network.ozone.ctx.pdsAgent.tools.ozone.signature,
          'searchAccounts',
        )
        .mockResolvedValue({
          success: true,
          headers: {},
          data: { cursor: undefined, accounts: [] },
        })
      jest
        .spyOn(
          network.ozone.ctx.pdsAgent.tools.ozone.signature,
          'findCorrelation',
        )
        .mockResolvedValue({
          success: true,
          headers: {},
          data: { details: [] },
        })
    }

    await network.processAll()
  })

  afterAll(async () => {
    await network.close()
  })

  const ozoneClient = () => network.ozone.getClient()

  describe('private proxy: tools.ozone.hosting.getAccountHistory (F26)', () => {
    const lxm = ids.ToolsOzoneHostingGetAccountHistory

    it('rejects anonymous caller with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory({
            did: sc.dids.alice,
          }),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().tools.ozone.hosting.getAccountHistory(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows admin JWT', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().tools.ozone.hosting.getAccountHistory(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().tools.ozone.hosting.getAccountHistory(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('private proxy: com.atproto.admin.searchAccounts (F26)', () => {
    const lxm = ids.ComAtprotoAdminSearchAccounts

    it('rejects anonymous caller with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().com.atproto.admin.searchAccounts({}),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().com.atproto.admin.searchAccounts(
            {},
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const verifierHeaders = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().com.atproto.admin.searchAccounts(
            {},
            { headers: verifierHeaders },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const triageHeaders = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().com.atproto.admin.searchAccounts(
            {},
            { headers: triageHeaders },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().com.atproto.admin.searchAccounts(
        {},
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows admin JWT', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().com.atproto.admin.searchAccounts(
        {},
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().com.atproto.admin.searchAccounts(
        {},
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('private proxy: tools.ozone.signature.findRelatedAccounts (F26)', () => {
    const lxm = ids.ToolsOzoneSignatureFindRelatedAccounts

    it('rejects anonymous caller with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.signature.findRelatedAccounts({
            did: sc.dids.alice,
          }),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findRelatedAccounts(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findRelatedAccounts(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findRelatedAccounts(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.findRelatedAccounts(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows admin JWT', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.findRelatedAccounts(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().tools.ozone.signature.findRelatedAccounts(
        { did: sc.dids.alice },
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('private proxy: tools.ozone.signature.searchAccounts (F26)', () => {
    const lxm = ids.ToolsOzoneSignatureSearchAccounts

    it('rejects anonymous caller with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.signature.searchAccounts({
            values: ['test'],
          }),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.searchAccounts(
            { values: ['test'] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.searchAccounts(
            { values: ['test'] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.searchAccounts(
            { values: ['test'] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.searchAccounts(
        { values: ['test'] },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows admin JWT', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.searchAccounts(
        { values: ['test'] },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().tools.ozone.signature.searchAccounts(
        { values: ['test'] },
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('private proxy: tools.ozone.signature.findCorrelation (F26)', () => {
    const lxm = ids.ToolsOzoneSignatureFindCorrelation

    it('rejects anonymous caller with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.signature.findCorrelation({
            dids: [sc.dids.alice, sc.dids.bob],
          }),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findCorrelation(
            { dids: [sc.dids.alice, sc.dids.bob] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findCorrelation(
            { dids: [sc.dids.alice, sc.dids.bob] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with zero downstream calls (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().tools.ozone.signature.findCorrelation(
            { dids: [sc.dids.alice, sc.dids.bob] },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.findCorrelation(
        { dids: [sc.dids.alice, sc.dids.bob] },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows admin JWT', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().tools.ozone.signature.findCorrelation(
        { dids: [sc.dids.alice, sc.dids.bob] },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().tools.ozone.signature.findCorrelation(
        { dids: [sc.dids.alice, sc.dids.bob] },
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('public appview proxy: app.bsky.actor.getProfile & getProfiles', () => {
    it('allows enabled verifier and triage for non-sensitive public proxies', async () => {
      const verifierHeaders = await createAuthHeader(
        verifierUser,
        ids.AppBskyActorGetProfile,
      )
      const res1 = await ozoneClient().app.bsky.actor.getProfile(
        { actor: sc.dids.alice },
        { headers: verifierHeaders },
      )
      expect(res1.success).toBe(true)

      const triageHeaders = await createAuthHeader(
        triageUser,
        ids.AppBskyActorGetProfiles,
      )
      const res2 = await ozoneClient().app.bsky.actor.getProfiles(
        { actors: [sc.dids.alice, sc.dids.bob] },
        { headers: triageHeaders },
      )
      expect(res2.success).toBe(true)
    })

    it('rejects anonymous and disabled callers', async () => {
      await expect(
        ozoneClient().app.bsky.actor.getProfile({ actor: sc.dids.alice }),
      ).rejects.toThrow(/^missing jwt$/)

      const disabledHeaders = await createAuthHeader(
        disabledUser,
        ids.AppBskyActorGetProfile,
      )
      await expect(
        ozoneClient().app.bsky.actor.getProfile(
          { actor: sc.dids.alice },
          { headers: disabledHeaders },
        ),
      ).rejects.toThrow(/^Authentication Required$/)
    })
  })

  describe('local auth before network DID resolution (F16, Step 4)', () => {
    it('rejects arbitrary unsigned JWT issuer with ZERO network DID resolutions', async () => {
      const fakeKeypair = await Secp256k1Keypair.create()
      const fakeUser: DidAndKey = {
        did: 'did:web:arbitrary-untrusted-issuer.example.com',
        key: fakeKeypair,
      }
      const headers = await createAuthHeader(
        fakeUser,
        ids.ToolsOzoneHostingGetAccountHistory,
      )

      const resolveSpy = jest.spyOn(
        network.ozone.ctx.idResolver.did,
        'resolveAtprotoData',
      )
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(resolveSpy).toHaveBeenCalledTimes(0)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        resolveSpy.mockRestore()
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with ZERO network DID resolutions', async () => {
      const headers = await createAuthHeader(
        disabledUser,
        ids.ToolsOzoneHostingGetAccountHistory,
      )

      const resolveSpy = jest.spyOn(
        network.ozone.ctx.idResolver.did,
        'resolveAtprotoData',
      )
      try {
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(resolveSpy).toHaveBeenCalledTimes(0)
      } finally {
        resolveSpy.mockRestore()
      }
    })

    it('rejects role-insufficient member before DID resolution on protected route', async () => {
      const headers = await createAuthHeader(
        verifierUser,
        ids.ToolsOzoneHostingGetAccountHistory,
      )

      const resolveSpy = jest.spyOn(
        network.ozone.ctx.idResolver.did,
        'resolveAtprotoData',
      )
      try {
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(resolveSpy).toHaveBeenCalledTimes(0)
      } finally {
        resolveSpy.mockRestore()
      }
    })

    it('asserts byte-identical unauthenticated responses across unknown, disabled, verifier, and triage DIDs without leaking membership or role (O1-I1)', async () => {
      const fakeKeypair = await Secp256k1Keypair.create()
      const unknownUser: DidAndKey = {
        did: 'did:web:unknown-attacker-target.example.com',
        key: fakeKeypair,
      }
      const lxm = ids.ToolsOzoneHostingGetAccountHistory

      // Forged tokens with invalid signatures for each candidate DID
      const unknownHeaders = await createAuthHeader(unknownUser, lxm)
      const disabledHeaders = await createAuthHeader(
        { did: disabledUser.did, key: fakeKeypair },
        lxm,
      )
      const verifierHeaders = await createAuthHeader(
        { did: verifierUser.did, key: fakeKeypair },
        lxm,
      )
      const triageHeaders = await createAuthHeader(
        { did: triageUser.did, key: fakeKeypair },
        lxm,
      )

      const resolveSpy = jest.spyOn(
        network.ozone.ctx.idResolver.did,
        'resolveAtprotoData',
      )

      try {
        const getErr = async (headers: { authorization: string }) => {
          try {
            await ozoneClient().tools.ozone.hosting.getAccountHistory(
              { did: sc.dids.alice },
              { headers },
            )
            throw new Error('should have failed')
          } catch (err: unknown) {
            return err as { status?: number; error?: string; message?: string }
          }
        }

        const [errUnknown, errDisabled, errVerifier, errTriage] = await Promise.all([
          getErr(unknownHeaders),
          getErr(disabledHeaders),
          getErr(verifierHeaders),
          getErr(triageHeaders),
        ])

        // All 4 unauthenticated responses must be byte-identical
        expect(errUnknown.status).toBe(401)
        expect(errUnknown.error).toBe('AuthenticationRequired')
        expect(errUnknown.message).toBe('Authentication Required')

        expect(errDisabled.status).toBe(errUnknown.status)
        expect(errDisabled.error).toBe(errUnknown.error)
        expect(errDisabled.message).toBe(errUnknown.message)

        expect(errVerifier.status).toBe(errUnknown.status)
        expect(errVerifier.error).toBe(errUnknown.error)
        expect(errVerifier.message).toBe(errUnknown.message)

        expect(errTriage.status).toBe(errUnknown.status)
        expect(errTriage.error).toBe(errUnknown.error)
        expect(errTriage.message).toBe(errUnknown.message)

        // Zero network DID resolution calls for unknown non-member, disabled, and insufficient roles
        expect(resolveSpy).toHaveBeenCalledTimes(0)
      } finally {
        resolveSpy.mockRestore()
      }
    })
  })

  describe('JWT payload parsing robust validation (O1-M1)', () => {
    it('rejects JWT whose payload decodes to null with 401 BadJwt instead of 500', () => {
      // header.payload.sig where payload is base64url('null') => 'bnVsbA'
      const nullPayloadJwt = 'eyJhbGciOiJFUzI1NksifQ.bnVsbA.fakesig'
      expect(() => parseJwtPayload(nullPayloadJwt)).toThrow('poorly formatted jwt')
    })

    it('rejects JWT whose payload has missing or non-string iss with 401 BadJwt', () => {
      const noIssPayload = Buffer.from(JSON.stringify({ aud: 'did:web:service' })).toString('base64url')
      const noIssJwt = `eyJhbGciOiJFUzI1NksifQ.${noIssPayload}.fakesig`
      expect(() => parseJwtPayload(noIssJwt)).toThrow('poorly formatted jwt')

      const numberIssPayload = Buffer.from(JSON.stringify({ iss: 12345 })).toString('base64url')
      const numberIssJwt = `eyJhbGciOiJFUzI1NksifQ.${numberIssPayload}.fakesig`
      expect(() => parseJwtPayload(numberIssJwt)).toThrow('poorly formatted jwt')
    })

    it('rejects JWT with invalid number of parts with 401 BadJwt', () => {
      expect(() => parseJwtPayload('not-a-jwt')).toThrow('poorly formatted jwt')
      expect(() => parseJwtPayload('one.two')).toThrow('poorly formatted jwt')
      expect(() => parseJwtPayload('one.two.three.four')).toThrow('poorly formatted jwt')
    })

    it('rejects JWT with invalid JSON payload with 401 BadJwt', () => {
      const badJsonPayload = Buffer.from('not json{').toString('base64url')
      const badJsonJwt = `eyJhbGciOiJFUzI1NksifQ.${badJsonPayload}.fakesig`
      expect(() => parseJwtPayload(badJsonJwt)).toThrow('poorly formatted jwt')
    })
  })
})
