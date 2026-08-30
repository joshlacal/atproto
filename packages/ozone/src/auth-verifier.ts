import express from 'express'
import * as ui8 from 'uint8arrays'
import { IdResolver } from '@atproto/identity'
import {
  AuthRequiredError,
  parseReqNsid,
  verifyJwt,
} from '@atproto/xrpc-server'
import { TeamService } from './team'

type ReqCtx = {
  req: express.Request
}

export type AdminTokenOutput = {
  credentials: {
    type: 'admin_token'
    isAdmin: true
    isModerator: true
    isTriage: true
    isVerifier: true
  }
}

export type ModeratorOutput = {
  credentials: {
    type: 'moderator'
    aud: string
    iss: string
    isAdmin: boolean
    isModerator: boolean
    isTriage: boolean
    isVerifier: boolean
  }
}

type StandardOutput = {
  credentials: {
    type: 'standard'
    aud: string
    iss: string
    isAdmin: boolean
    isModerator: boolean
    isTriage: boolean
    isVerifier: boolean
  }
}

type NullOutput = {
  credentials: {
    type: 'none'
    iss: null
  }
}

export type MemberRoles = {
  isModerator: boolean
  isAdmin: boolean
  isTriage: boolean
  isVerifier: boolean
}

export type AuthVerifierOpts = {
  serviceDid: string
  adminPassword: string
  teamService: TeamService
}

export class AuthVerifier {
  serviceDid: string
  teamService: TeamService
  private adminPassword: string

  constructor(
    public idResolver: IdResolver,
    opts: AuthVerifierOpts,
  ) {
    this.serviceDid = opts.serviceDid
    this.adminPassword = opts.adminPassword
    this.teamService = opts.teamService
  }

  admin = async (reqCtx: ReqCtx): Promise<ModeratorOutput> => {
    const creds = await this.authenticateMember(
      reqCtx,
      (r) => r.isAdmin,
      'not an admin account',
    )
    return {
      credentials: {
        type: 'moderator',
        ...creds,
      },
    }
  }

  adminOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<ModeratorOutput | AdminTokenOutput> => {
    if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    }
    return this.admin(reqCtx)
  }

  fullModerator = async (reqCtx: ReqCtx): Promise<ModeratorOutput> => {
    const creds = await this.authenticateMember(
      reqCtx,
      (r) => r.isModerator,
      'not a moderator account',
    )
    return {
      credentials: {
        type: 'moderator',
        ...creds,
      },
    }
  }

  fullModeratorOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<ModeratorOutput | AdminTokenOutput> => {
    if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    }
    return this.fullModerator(reqCtx)
  }

  moderator = async (reqCtx: ReqCtx): Promise<ModeratorOutput> => {
    return this.fullModerator(reqCtx)
  }

  modOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<ModeratorOutput | AdminTokenOutput> => {
    if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    }
    return this.teamMember(reqCtx)
  }

  teamMember = async (reqCtx: ReqCtx): Promise<ModeratorOutput> => {
    const creds = await this.authenticateMember(reqCtx)
    return {
      credentials: {
        type: 'moderator',
        ...creds,
      },
    }
  }

  teamMemberOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<ModeratorOutput | AdminTokenOutput> => {
    if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    }
    return this.teamMember(reqCtx)
  }

  verifier = async (reqCtx: ReqCtx): Promise<ModeratorOutput> => {
    const creds = await this.authenticateMember(
      reqCtx,
      (r) => r.isVerifier,
      'not a verifier account',
    )
    return {
      credentials: {
        type: 'moderator',
        ...creds,
      },
    }
  }

  verifierOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<ModeratorOutput | AdminTokenOutput> => {
    if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    }
    return this.verifier(reqCtx)
  }

  private async authenticateMember(
    reqCtx: ReqCtx,
    rolePredicate?: (role: MemberRoles) => boolean,
    roleErrorMessage?: string,
  ): Promise<{
    iss: string
    aud: string
    isAdmin: boolean
    isModerator: boolean
    isTriage: boolean
    isVerifier: boolean
  }> {
    const jwtStr = getJwtStrFromReq(reqCtx.req)
    if (!jwtStr) {
      throw new AuthRequiredError('missing jwt', 'MissingJwt')
    }
    const payload = parseJwtPayload(jwtStr)
    const iss = payload.iss
    if (!iss || typeof iss !== 'string') {
      throw new AuthRequiredError('missing jwt issuer', 'BadJwt')
    }

    const member = await this.teamService.getMember(iss)
    if (!member) {
      throw new AuthRequiredError('not a team member', 'NotMember')
    }
    if (member.disabled) {
      throw new AuthRequiredError('member is disabled', 'MemberDisabled')
    }

    const role = this.teamService.getMemberRole(member)
    if (rolePredicate && !rolePredicate(role)) {
      throw new AuthRequiredError(
        roleErrorMessage ?? 'insufficient role',
      )
    }

    const nsid = parseReqNsid(reqCtx.req)
    const getSigningKey = async (
      did: string,
      forceRefresh: boolean,
    ): Promise<string> => {
      const atprotoData = await this.idResolver.did.resolveAtprotoData(
        did,
        forceRefresh,
      )
      return atprotoData.signingKey
    }

    const verified = await verifyJwt(
      jwtStr,
      this.serviceDid,
      nsid,
      getSigningKey,
    )

    return {
      iss: verified.iss,
      aud: verified.aud,
      ...role,
    }
  }

  standard = async (reqCtx: ReqCtx): Promise<StandardOutput> => {
    const jwtStr = getJwtStrFromReq(reqCtx.req)
    if (!jwtStr) {
      throw new AuthRequiredError('missing jwt', 'MissingJwt')
    }
    const payload = parseJwtPayload(jwtStr)
    const iss = payload.iss
    if (!iss || typeof iss !== 'string') {
      throw new AuthRequiredError('missing jwt issuer', 'BadJwt')
    }

    const member = await this.teamService.getMember(iss)
    if (member?.disabled) {
      throw new AuthRequiredError('member is disabled', 'MemberDisabled')
    }

    const nsid = parseReqNsid(reqCtx.req)
    const getSigningKey = async (
      did: string,
      forceRefresh: boolean,
    ): Promise<string> => {
      const atprotoData = await this.idResolver.did.resolveAtprotoData(
        did,
        forceRefresh,
      )
      return atprotoData.signingKey
    }

    const verified = await verifyJwt(
      jwtStr,
      this.serviceDid,
      nsid,
      getSigningKey,
    )

    const { isAdmin, isModerator, isTriage, isVerifier } =
      this.teamService.getMemberRole(member)

    return {
      credentials: {
        type: 'standard',
        iss: verified.iss,
        aud: verified.aud,
        isAdmin,
        isModerator,
        isTriage,
        isVerifier,
      },
    }
  }

  standardOptional = async (
    reqCtx: ReqCtx,
  ): Promise<StandardOutput | NullOutput> => {
    if (isBearerToken(reqCtx.req)) {
      return this.standard(reqCtx)
    }
    return this.nullCreds()
  }

  standardOptionalOrAdminToken = async (
    reqCtx: ReqCtx,
  ): Promise<StandardOutput | AdminTokenOutput | NullOutput> => {
    if (isBearerToken(reqCtx.req)) {
      return this.standard(reqCtx)
    } else if (isBasicToken(reqCtx.req)) {
      return this.adminToken(reqCtx)
    } else {
      return this.nullCreds()
    }
  }

  adminToken = async (reqCtx: ReqCtx): Promise<AdminTokenOutput> => {
    const parsed = parseBasicAuth(reqCtx.req.headers.authorization ?? '')
    const { username, password } = parsed ?? {}
    if (username !== 'admin' || password !== this.adminPassword) {
      throw new AuthRequiredError()
    }
    return {
      credentials: {
        type: 'admin_token',
        isAdmin: true,
        isModerator: true,
        isTriage: true,
        isVerifier: true,
      },
    }
  }

  nullCreds(): NullOutput {
    return {
      credentials: {
        type: 'none',
        iss: null,
      },
    }
  }
}

const BEARER = 'Bearer '
const BASIC = 'Basic '

const isBearerToken = (req: express.Request): boolean => {
  return req.headers.authorization?.startsWith(BEARER) ?? false
}

const isBasicToken = (req: express.Request): boolean => {
  return req.headers.authorization?.startsWith(BASIC) ?? false
}

export const getJwtStrFromReq = (req: express.Request): string | null => {
  const { authorization } = req.headers
  if (!authorization?.startsWith(BEARER)) {
    return null
  }
  return authorization.slice(BEARER.length).trim()
}

export const parseBasicAuth = (
  token: string,
): { username: string; password: string } | null => {
  if (!token.startsWith(BASIC)) return null
  const b64 = token.slice(BASIC.length)
  let parsed: string[]
  try {
    parsed = ui8.toString(ui8.fromString(b64, 'base64pad'), 'utf8').split(':')
  } catch (err) {
    return null
  }
  const [username, password] = parsed
  if (!username || !password) return null
  return { username, password }
}

export const parseJwtPayload = (
  jwtStr: string,
): { iss?: string; aud?: string; exp?: number; lxm?: string } => {
  const parts = jwtStr.split('.')
  if (parts.length !== 3) {
    throw new AuthRequiredError('poorly formatted jwt', 'BadJwt')
  }
  try {
    const json = ui8.toString(ui8.fromString(parts[1], 'base64url'), 'utf8')
    return JSON.parse(json)
  } catch (err) {
    throw new AuthRequiredError('poorly formatted jwt', 'BadJwt')
  }
}
