import {
  AuthRequiredError,
  InvalidRequestError,
  MethodAuthVerifier,
} from '@atproto/xrpc-server'
import {
  AccessOutput,
  AdminTokenOutput,
  OAuthOutput,
  UnauthenticatedOutput,
  UserServiceAuthOutput,
} from '../../../../auth-output'
import { AppContext } from '../../../../context'
import { Server } from '../../../../lexicon'

type ReserveKeyAuth =
  | UserServiceAuthOutput
  | AdminTokenOutput
  | OAuthOutput
  | AccessOutput
  | UnauthenticatedOutput

export default function (server: Server, ctx: AppContext) {
  const isEntryway = Boolean(ctx.cfg.entryway)

  const authVerifier: MethodAuthVerifier<ReserveKeyAuth> = async (reqCtx) => {
    if (isEntryway) {
      return { credentials: null }
    }
    const authHeader = reqCtx.req.headers['authorization']
    if (authHeader?.startsWith('Basic ')) {
      return ctx.authVerifier.adminToken(reqCtx)
    } else if (authHeader?.startsWith('Bearer ')) {
      return ctx.authVerifier.userServiceAuth(reqCtx)
    } else {
      return ctx.authVerifier.unauthenticated(reqCtx)
    }
  }

  server.com.atproto.server.reserveSigningKey({
    auth: authVerifier,
    handler: async ({ input, auth }) => {
      const isAdmin = auth.credentials?.type === 'admin_token'

      if (isEntryway || isAdmin) {
        const signingKey = await ctx.actorStore.reserveKeypair(input.body.did)
        return {
          encoding: 'application/json',
          body: {
            signingKey,
          },
        }
      }

      const did = input.body.did
      if (!did || typeof did !== 'string') {
        throw new InvalidRequestError('did is required')
      }
      const requester =
        auth.credentials && 'did' in auth.credentials
          ? auth.credentials.did
          : null
      if (!requester || requester !== did) {
        throw new AuthRequiredError(
          `Missing auth to reserve signing key for did: ${did}`,
        )
      }
      const signingKey = await ctx.actorStore.reserveKeypair(did)
      return {
        encoding: 'application/json',
        body: {
          signingKey,
        },
      }
    },
  })
}
