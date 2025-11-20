# OAuth Debug PDS - Quick Reference

## 🎉 Status: RUNNING ✓

Your PDS is currently running on http://localhost:3000 with OAuth debugging enabled!

## Current Session

- **Node Version**: 22.21.1
- **Port**: 3000
- **Data Directory**: /Users/joshlacalamito/Developer/atproto-oauth-debug/pds-data
- **Debug Level**: debug
- **Logged Systems**: pds:oauth, pds:fetch, pds:db, pds:lexicon-resolver

## Quick Commands

```bash
# Start PDS
./start-pds.sh

# Stop PDS
./stop-pds.sh

# Check if running
curl http://localhost:3000/xrpc/_health

# View OAuth metadata
curl http://localhost:3000/.well-known/oauth-authorization-server | jq
```

## Next Steps for VPS Deployment

1. **On your VPS**, pull the repository:
   ```bash
   cd /path/to/atproto-oauth-debug
   git pull origin claude/pds-oauth-debug-logging-018Egcsi39FeMHXqCBPSt8vH
   ```

2. **Install Node 22** (if not already):
   ```bash
   nvm install 22
   nvm use 22
   ```

3. **Install dependencies and build**:
   ```bash
   pnpm install
   pnpm build
   ```

4. **Update oauth-debug.env** with your VPS settings:
   ```bash
   nano oauth-debug.env
   
   # Change these lines:
   PDS_HOSTNAME="your-vps-domain.com"
   PDS_SERVICE_DID="did:web:your-vps-domain.com"
   PDS_DATA_DIRECTORY="/path/to/data"
   PDS_BLOBSTORE_DISK_LOCATION="/path/to/blobs"
   
   # For production with HTTPS:
   PDS_DEV_MODE=false
   ```

5. **Start with PM2** (recommended for production):
   ```bash
   npm install -g pm2
   pm2 start ./start-pds.sh --name pds-oauth-debug
   pm2 save
   pm2 startup  # Follow instructions
   ```

6. **View logs**:
   ```bash
   pm2 logs pds-oauth-debug --lines 100
   ```

## Testing Your Petrel OAuth Client

Once the PDS is running on your VPS, point your Petrel library at it:

```swift
// In your Petrel client configuration
let pdsURL = "https://your-vps-domain.com"  // or http://localhost:3000 for local
```

Watch the PDS logs to see detailed OAuth flow information:
- DPoP proof validation
- Token issuance and validation
- Scope resolution
- Authorization flow steps

## Files Created

- ✅ `oauth-debug.env` - Configuration with secure secrets
- ✅ `start-pds.sh` - Startup script
- ✅ `stop-pds.sh` - Stop script
- ✅ `OAUTH_DEBUG_SETUP.md` - Comprehensive documentation
- ✅ `OAUTH_DEBUG_SUMMARY.md` - This quick reference

## Key Configuration Points

### Secrets (already generated):
- **DPoP Secret**: 64-char hex for nonce generation
- **JWT Secret**: Base64 secret for token signing
- **PLC Rotation Key**: secp256k1 private key for DID operations

### Dev Mode:
- Enabled for local testing (allows HTTP)
- Disable for production with HTTPS

### Logging:
- Level: debug (info for production)
- Systems: OAuth, fetch, db, lexicon-resolver

## Troubleshooting

### PDS won't start
```bash
# Check Node version
node --version  # Should be 22.x

# Rebuild if needed
pnpm build

# Check logs in real-time
./start-pds.sh  # Watch output
```

### Can't connect to PDS
```bash
# Verify it's running
curl http://localhost:3000/xrpc/_health

# Check process
ps aux | grep "node.*pds"
```

## Support Files

See `OAUTH_DEBUG_SETUP.md` for comprehensive documentation including:
- Full setup instructions
- VPS deployment guide
- Detailed troubleshooting
- Configuration reference
