import { DidResolver } from './did/did-resolver'
import { HandleResolver } from './handle'
import { IdentityResolverOpts } from './types'

export class IdResolver {
  public handle: HandleResolver
  public did: DidResolver

  constructor(opts: IdentityResolverOpts = {}) {
    const { timeout = 3000, plcUrl, didCache, fetch } = opts
    this.handle = new HandleResolver({
      timeout,
      backupNameservers: opts.backupNameservers,
      fetch,
    })
    this.did = new DidResolver({ timeout, plcUrl, didCache, fetch })
  }
}
