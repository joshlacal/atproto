# OAuth Debug PDS Setup

This is a configured PDS instance for debugging OAuth implementations.

## Prerequisites

- Node.js 22 (use nvm: `nvm use 22`)
- pnpm 8.15.9+

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build All Packages

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm build
```

### 3. Start the PDS

```bash
./start-pds.sh
```

The PDS will start on http://localhost:3000 with OAuth debugging enabled.

### 4. Stop the PDS

```bash
./stop-pds.sh
```

Or press Ctrl+C if running in foreground.

## Configuration

The OAuth debug configuration is in `oauth-debug.env`. Key settings:

- **LOG_LEVEL=debug**: Enable detailed logging
- **LOG_SYSTEMS**: OAuth-focused logging subsystems
- **PDS_DPOP_SECRET**: DPoP nonce secret (required for DPoP)
- **PDS_DEV_MODE=true**: Allows HTTP for local testing

## OAuth Endpoints

Once running, these endpoints are available:

- **Health**: http://localhost:3000/xrpc/_health
- **OAuth Metadata**: http://localhost:3000/.well-known/oauth-authorization-server
- **Protected Resource**: http://localhost:3000/.well-known/oauth-protected-resource

## Logs

Logs are written to stdout with OAuth-specific debugging enabled. The following subsystems are logged:

- `pds:oauth` - Core OAuth operations (tokens, DPoP, authentication)
- `pds:fetch` - HTTP requests (metadata, scope resolution)
- `pds:db` - Database operations (token storage, sessions)
- `pds:lexicon-resolver` - Scope validation

## Debugging Your Client

When testing your OAuth client library against this PDS:

1. Point your client to `http://localhost:3000`
2. Watch the PDS logs for detailed OAuth flow information
3. Look for DPoP errors, token validation issues, or scope problems
4. Use `grep` to filter logs by your client ID or specific operations

## Data Storage

- **SQLite Database**: `/Users/joshlacalamito/Developer/atproto-oauth-debug/pds-data/`
- **Blobs**: `/Users/joshlacalamito/Developer/atproto-oauth-debug/pds-blobs/`

## Deploying to VPS

1. **Commit and push your changes**:
   ```bash
   git add .
   git commit -m "Configure OAuth debug PDS"
   git push
   ```

2. **On your VPS, pull and build**:
   ```bash
   git pull
   nvm use 22
   pnpm install
   pnpm build
   ```

3. **Update `oauth-debug.env`** with your VPS hostname:
   ```bash
   PDS_HOSTNAME="your-vps-domain.com"
   PDS_SERVICE_DID="did:web:your-vps-domain.com"
   # For production, consider:
   # PDS_DEV_MODE=false (requires HTTPS)
   # LOG_LEVEL=info
   ```

4. **Run with process manager** (e.g., pm2):
   ```bash
   npm install -g pm2
   pm2 start ./start-pds.sh --name pds-oauth-debug
   pm2 logs pds-oauth-debug
   ```

## Troubleshooting

### "Cannot find module" errors
Run `pnpm build` to build all packages.

### "Cannot open database" errors
Ensure data directories exist and have correct permissions.

### "HTTPS required" errors
Set `PDS_DEV_MODE=true` in `oauth-debug.env` for local testing.

### No logs appearing
Check `LOG_ENABLED=true` and `LOG_LEVEL=debug` in `oauth-debug.env`.

## Notes

- This is a **development/debug** configuration
- For production, use HTTPS and disable dev mode
- The PLC rotation key is randomly generated - don't lose it if you create real accounts
- Admin password is in the env file - change it before deploying
