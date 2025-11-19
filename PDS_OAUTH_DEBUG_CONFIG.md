# PDS OAuth Debug Configuration

This configuration enables extensive OAuth logging for debugging client
implementations, with focus on tokens, DPoP, and authentication issues.

## Quick Start Configuration

Add these environment variables to your PDS configuration:

```bash
# ============================================================================
# OAUTH DEBUG LOGGING CONFIGURATION
# ============================================================================

# Enable debug-level logging for OAuth subsystems
LOG_ENABLED=true
LOG_LEVEL=debug
LOG_SYSTEMS="pds:oauth pds:fetch pds:db pds:lexicon-resolver"

# Optional: Write logs to a dedicated file for easier debugging
LOG_DESTINATION=/var/log/pds/oauth-debug.log

# ============================================================================
# DPOP CONFIGURATION
# ============================================================================

# DPoP secret for nonce generation (32 bytes, 64 hex characters)
# Generate with: openssl rand -hex 32
PDS_DPOP_SECRET="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# ============================================================================
# REQUIRED PDS SETTINGS (if not already configured)
# ============================================================================

# JWT secret for token signing
PDS_JWT_SECRET="your-jwt-secret-here"

# Admin password
PDS_ADMIN_PASSWORD="your-admin-password"

# Your PDS hostname
PDS_HOSTNAME="your-pds.example.com"

# ============================================================================
# OPTIONAL OAUTH SETTINGS
# ============================================================================

# Trusted OAuth clients (comma or space-separated)
# PDS_OAUTH_TRUSTED_CLIENTS="https://client1.example.com,https://client2.example.com"

# OAuth provider branding
# PDS_OAUTH_PROVIDER_NAME="My PDS"
# PDS_OAUTH_PROVIDER_LOGO="https://example.com/logo.png"

# ============================================================================
# REDIS (Recommended for DPoP replay protection)
# ============================================================================

# Redis connection for OAuth replay protection and nonce management
# PDS_REDIS_SCRATCH_ADDRESS="redis://localhost:6379"
```

## What Gets Logged

With this configuration, you'll see detailed logs for:

### 1. **Token Operations**

- Token creation and issuance
- Token validation and verification
- Refresh token usage
- Token expiration checks
- Audience (aud) validation
- Scope validation
- Token rotation events

### 2. **DPoP (Demonstrating Proof-of-Possession)**

- DPoP proof validation
- `htm` (HTTP method) validation
- `htu` (HTTP URI) validation
- `ath` (access token hash) validation
- `jti` (JWT ID) uniqueness checks
- Nonce generation and validation
- Proof replay protection
- Key binding validation (`cnf.jkt` claim)

### 3. **Authentication Errors**

All OAuth errors except these "normal" errors (which are filtered to reduce
noise):

- Invalid identifier or password
- DPoP nonce required (handled automatically)
- Handle unavailable
- 2FA required

### 4. **OAuth Flow Events**

- Authorization requests
- Token endpoint requests
- Client authentication
- Scope dereferencing (when using entryway)
- HTTP fetch operations for OAuth metadata

### 5. **Database Operations**

- Token storage and retrieval
- Session management
- Account lookups

## Common OAuth Errors You'll See

### DPoP Errors

**`InvalidDpopProofError`**

- Invalid DPoP proof structure or claims
- Missing required claims (htm, htu, jti, iat)
- Invalid signature

**`InvalidDpopKeyBindingError`**

- DPoP key doesn't match the bound key in token
- `cnf.jkt` claim mismatch

**`UseDpopNonceError`**

- Server requires a nonce (use the nonce from error response)
- Nonce mismatch or expired

### Token Errors

**Token Validation Failures**

- Expired tokens
- Invalid audience
- Invalid scope
- Missing or invalid DPoP binding

### Client Errors

**`InvalidRequestError`**

- Malformed requests
- Missing required parameters
- Invalid parameter values

**`InvalidClientError`**

- Client authentication failed
- Unknown client_id

## Debugging Tips

### 1. Check DPoP Proof Structure

Ensure your client sends DPoP proofs with:

```json
{
  "htm": "POST",
  "htu": "https://pds.example.com/oauth/token",
  "jti": "unique-identifier",
  "iat": 1234567890,
  "ath": "base64url-hash-of-access-token" // for resource requests
}
```

### 2. Handle DPoP Nonces

When you receive `UseDpopNonceError`:

1. Extract the nonce from the `DPoP-Nonce` response header
2. Include it in the next DPoP proof as the `nonce` claim
3. Retry the request

### 3. Watch for Token Expiration

Access tokens expire quickly. Monitor `exp` claims and refresh proactively.

### 4. Verify Token Binding

If using DPoP, the access token contains `cnf.jkt` (confirmation key
thumbprint). All requests with that token MUST use the same DPoP key.

### 5. Check Logs for Client ID

Search logs for your `client_id` to trace your specific requests:

```bash
grep "your-client-id" /var/log/pds/oauth-debug.log
```

## Log Subsystems Explained

- **`pds:oauth`** - Core OAuth operations (auth, token, validation)
- **`pds:fetch`** - HTTP requests made by PDS (metadata fetching, scope
  resolution)
- **`pds:db`** - Database operations (token/session storage)
- **`pds:lexicon-resolver`** - Scope validation and lexicon resolution

## Production vs Debug

**For debugging:**

```bash
LOG_LEVEL=debug
LOG_SYSTEMS="pds:oauth pds:fetch pds:db pds:lexicon-resolver"
```

**For production:**

```bash
LOG_LEVEL=info
LOG_SYSTEMS="pds:oauth"  # Only OAuth, or leave unset for all
```

## Generating Secrets

Generate a secure DPoP secret:

```bash
openssl rand -hex 32
```

Generate a JWT secret:

```bash
openssl rand -base64 32
```

## Testing Your Configuration

1. Start your PDS with the debug configuration
2. Monitor the logs: `tail -f /var/log/pds/oauth-debug.log`
3. Make an OAuth request from your client
4. Check the logs for detailed information about each step

## Common Log Patterns

**Successful token issuance:**

```
[DEBUG] pds:oauth: Token validation successful
[INFO] pds:oauth: Access token issued
```

**DPoP nonce required:**

```
[INFO] pds:oauth: DPoP nonce required
```

**DPoP proof validation:**

```
[DEBUG] pds:oauth: Validating DPoP proof
[DEBUG] pds:oauth: DPoP htm validated: POST
[DEBUG] pds:oauth: DPoP htu validated: https://...
[DEBUG] pds:oauth: DPoP key binding validated
```

**Scope dereferencing (with entryway):**

```
[INFO] pds:oauth: Fetching scope reference
[DEBUG] pds:fetch: GET https://entryway.example.com/...
[INFO] pds:oauth: Successfully fetched scope reference
```

## Additional Resources

- OAuth Provider: `packages/pds/src/context.ts` (lines 373-442)
- DPoP Manager: `packages/oauth/oauth-provider/src/dpop/dpop-manager.ts`
- Auth Routes: `packages/pds/src/auth-routes.ts`
- Logger Configuration: `packages/common/src/logger.ts`

## Need More Debug Info?

If you need even more detailed logging, you can:

1. Add more subsystems to `LOG_SYSTEMS` (see `packages/pds/src/logger.ts` for
   all available subsystems)
2. Check the source code at the locations mentioned in "Additional Resources"
3. Add custom logging by modifying the PDS source code

## Troubleshooting

**No logs appearing?**

- Verify `LOG_ENABLED=true`
- Check `LOG_DESTINATION` path is writable
- Ensure logs are going to stdout if no destination is set

**Too many logs?**

- Remove subsystems from `LOG_SYSTEMS` (start with just `pds:oauth`)
- Increase `LOG_LEVEL` to `info` or `warn`

**Logs missing OAuth details?**

- Ensure `LOG_LEVEL=debug` for maximum detail
- Check that `pds:oauth` is in `LOG_SYSTEMS`
- Verify your OAuth requests are actually reaching the PDS
