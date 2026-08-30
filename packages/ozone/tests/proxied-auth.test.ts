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

    it('rejects anonymous caller', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory({
            did: sc.dids.alice,
          }),
        ).rejects.toThrow(/Authentication Required|missing jwt/i)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/member is disabled/i)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/not a moderator account|Authentication Required/i)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role (F26)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().tools.ozone.hosting.getAccountHistory(
            { did: sc.dids.alice },
            { headers },
          ),
        ).rejects.toThrow(/not a moderator account|Authentication Required/i)
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

    it('rejects verifier and triage roles', async () => {
      const verifierHeaders = await createAuthHeader(verifierUser, lxm)
      await expect(
        ozoneClient().com.atproto.admin.searchAccounts(
          {},
          { headers: verifierHeaders },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)

      const triageHeaders = await createAuthHeader(triageUser, lxm)
      await expect(
        ozoneClient().com.atproto.admin.searchAccounts(
          {},
          { headers: triageHeaders },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)
    })

    it('allows moderator role', async () => {
      const headers = await createAuthHeader(modUser, lxm)
      const res = await ozoneClient().com.atproto.admin.searchAccounts(
        {},
        { headers },
      )
      expect(res.success).toBe(true)
    })
  })

  describe('private proxy: tools.ozone.signature.* (F26)', () => {
    it('rejects verifier and triage for findRelatedAccounts, searchAccounts, findCorrelation', async () => {
      const verifierHeaders1 = await createAuthHeader(
        verifierUser,
        ids.ToolsOzoneSignatureFindRelatedAccounts,
      )
      await expect(
        ozoneClient().tools.ozone.signature.findRelatedAccounts(
          { did: sc.dids.alice },
          { headers: verifierHeaders1 },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)

      const triageHeaders1 = await createAuthHeader(
        triageUser,
        ids.ToolsOzoneSignatureFindRelatedAccounts,
      )
      await expect(
        ozoneClient().tools.ozone.signature.findRelatedAccounts(
          { did: sc.dids.alice },
          { headers: triageHeaders1 },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)

      const verifierHeaders2 = await createAuthHeader(
        verifierUser,
        ids.ToolsOzoneSignatureSearchAccounts,
      )
      await expect(
        ozoneClient().tools.ozone.signature.searchAccounts(
          { values: ['test'] },
          { headers: verifierHeaders2 },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)

      const verifierHeaders3 = await createAuthHeader(
        verifierUser,
        ids.ToolsOzoneSignatureFindCorrelation,
      )
      await expect(
        ozoneClient().tools.ozone.signature.findCorrelation(
          { dids: [sc.dids.alice, sc.dids.bob] },
          { headers: verifierHeaders3 },
        ),
      ).rejects.toThrow(/not a moderator account|Authentication Required/i)
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
      ).rejects.toThrow(/Authentication Required|missing jwt/i)

      const disabledHeaders = await createAuthHeader(
        disabledUser,
        ids.AppBskyActorGetProfile,
      )
      await expect(
        ozoneClient().app.bsky.actor.getProfile(
          { actor: sc.dids.alice },
          { headers: disabledHeaders },
        ),
      ).rejects.toThrow(/member is disabled/i)
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
        ).rejects.toThrow(/not a team member|not a moderator account|Authentication Required/i)
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
        ).rejects.toThrow(/member is disabled/i)
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
        ).rejects.toThrow(/not a moderator account/i)
        expect(resolveSpy).toHaveBeenCalledTimes(0)
      } finally {
        resolveSpy.mockRestore()
      }
    })
  })
})
