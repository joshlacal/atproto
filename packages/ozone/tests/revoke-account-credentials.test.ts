import { Secp256k1Keypair } from '@atproto/crypto'
import { createServiceJwt } from '@atproto/xrpc-server'
import {
  ADMIN_PASSWORD,
  DidAndKey,
  ModeratorClient,
  SeedClient,
  TestNetwork,
  basicSeed,
  createDidAndKey,
} from '@atproto/dev-env'
import { ids } from '../src/lexicon/lexicons'

describe('revoke account credentials event and proxy authorization', () => {
  let network: TestNetwork
  let sc: SeedClient
  let modClient: ModeratorClient

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
      dbPostgresSchema: 'ozone_revoke_account_credentials',
    })
    sc = network.getSeedClient()
    modClient = network.ozone.getModClient()
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
      role: 'tools.ozone.team.defs#roleAdmin',
    })

    // Mock downstream PDS call for revokeAccountCredentials
    if (network.ozone.ctx.pdsAgent) {
      jest
        .spyOn(
          network.ozone.ctx.pdsAgent.com.atproto.temp,
          'revokeAccountCredentials',
        )
        .mockResolvedValue({
          success: true,
          headers: {},
        })
    }
    await network.processAll()
  })

  afterAll(async () => {
    await network.close()
  })

  describe('moderation emitEvent revokeAccountCredentials', () => {
    it('fails on non account subjects and for non admins', async () => {
      await expect(
        modClient.emitEvent({
          subject: {
            $type: 'com.atproto.repo.strongRef',
            uri: sc.posts[sc.dids.alice][0].ref.uriStr,
            cid: sc.posts[sc.dids.alice][0].ref.cidStr,
          },
          event: {
            $type: 'tools.ozone.moderation.defs#revokeAccountCredentialsEvent',
            comment: 'user was hacked',
          },
        }),
      ).rejects.toThrow('Invalid subject type')
      await expect(
        modClient.emitEvent({
          subject: {
            $type: 'com.atproto.admin.defs#repoRef',
            did: sc.dids.alice,
          },
          event: {
            $type: 'tools.ozone.moderation.defs#revokeAccountCredentialsEvent',
            comment: 'user was hacked',
          },
        }),
      ).rejects.toThrow('Must be an admin to revoke account credentials')
    })
  })

  describe('proxied revokeAccountCredentials (F3)', () => {
    const lxm = ids.ComAtprotoTempRevokeAccountCredentials
    const ozoneClient = () => network.ozone.getClient()

    it('rejects anonymous request with 401 and zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials({
            account: sc.dids.bob,
          }),
        ).rejects.toThrow(/^missing jwt$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects disabled member with 401 and zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(disabledUser, lxm)
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials(
            { account: sc.dids.bob },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects verifier role with 401 and zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(verifierUser, lxm)
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials(
            { account: sc.dids.bob },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects triage role with 401 and zero downstream calls', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(triageUser, lxm)
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials(
            { account: sc.dids.bob },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('rejects moderator role with 401 and zero downstream calls (F3 root cause)', async () => {
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        const headers = await createAuthHeader(modUser, lxm)
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials(
            { account: sc.dids.bob },
            { headers },
          ),
        ).rejects.toThrow(/^Authentication Required$/)
        expect(pdsAuthSpy).toHaveBeenCalledTimes(0)
      } finally {
        pdsAuthSpy.mockRestore()
      }
    })

    it('allows admin JWT and calls downstream PDS', async () => {
      const headers = await createAuthHeader(adminUser, lxm)
      const res = await ozoneClient().com.atproto.temp.revokeAccountCredentials(
        { account: sc.dids.bob },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('allows Basic admin and calls downstream PDS', async () => {
      const headers = basicAdminAuthHeader()
      const res = await ozoneClient().com.atproto.temp.revokeAccountCredentials(
        { account: sc.dids.bob },
        { headers },
      )
      expect(res.success).toBe(true)
    })

    it('rejects arbitrary unsigned JWT issuer locally without DID resolution (F16)', async () => {
      const fakeKeypair = await Secp256k1Keypair.create()
      const fakeUser: DidAndKey = {
        did: 'did:web:untrusted-arbitrary-attacker.example.com',
        key: fakeKeypair,
      }
      const headers = await createAuthHeader(fakeUser, lxm)

      const resolveSpy = jest.spyOn(
        network.ozone.ctx.idResolver.did,
        'resolveAtprotoData',
      )
      const pdsAuthSpy = jest.spyOn(network.ozone.ctx, 'pdsAuth')
      try {
        await expect(
          ozoneClient().com.atproto.temp.revokeAccountCredentials(
            { account: sc.dids.bob },
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
  })
})
