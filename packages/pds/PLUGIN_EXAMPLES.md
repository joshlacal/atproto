# PDS Plugin Examples

This directory contains example plugins demonstrating the PDS plugin system capabilities.

## Examples Included

### 1. Encrypted Storage Plugin (`example-plugin-encrypted-storage.ts`)

A complete example showing how to:
- Create encrypted SQLcipher databases
- Store private user data securely
- Register custom API endpoints
- Run database migrations
- Handle CRUD operations

**Use Case**: Store private notes that are encrypted at rest.

**API Endpoints**:
- `POST /xrpc/app.plugin.encryptedStorage.createNote` - Create a note
- `GET /xrpc/app.plugin.encryptedStorage.listNotes` - List notes for a user
- `GET /xrpc/app.plugin.encryptedStorage.getNote` - Get a specific note
- `PUT /xrpc/app.plugin.encryptedStorage.updateNote` - Update a note
- `DELETE /xrpc/app.plugin.encryptedStorage.deleteNote` - Delete a note
- `GET /xrpc/app.plugin.encryptedStorage.health` - Health check

### 2. Sidecar Plugin (`example-plugin-sidecar.ts`)

Demonstrates how to:
- Run plugin logic in a separate process
- Communicate with sidecars via HTTP
- Forward events to sidecars
- Implement health checks
- Proxy API requests to sidecars

**Use Case**: Offload processing to a separate service or use a different language.

**API Endpoints**:
- `POST /xrpc/app.plugin.sidecar.rpc` - Generic RPC endpoint
- `GET /xrpc/app.plugin.sidecar.health` - Health check

### 3. Python Sidecar Server (`example-sidecar-server.py`)

A reference implementation of a sidecar server in Python showing:
- Sidecar protocol implementation
- Event handling
- RPC method handling
- Health checks

**Use Case**: Write plugins in Python (or adapt for other languages).

## Quick Start

### Running the Encrypted Storage Plugin

1. Set environment variables:
```bash
export PDS_PLUGINS_ENABLED=true
export PDS_PLUGINS_DATA_DIRECTORY=./data/plugins
export PDS_PLUGINS_CONFIG=./plugins-config.json
export PLUGIN_ENCRYPTION_KEY="your-secure-encryption-key"
```

2. Create `plugins-config.json`:
```json
[
  {
    "id": "encrypted-storage",
    "source": {
      "type": "local",
      "path": "./example-plugin-encrypted-storage.js"
    },
    "config": {
      "enabled": true
    }
  }
]
```

3. Start the PDS server

4. Test the plugin:
```bash
# Create a note
curl -X POST http://localhost:2583/xrpc/app.plugin.encryptedStorage.createNote \
  -H "Content-Type: application/json" \
  -d '{
    "did": "did:plc:example",
    "title": "My Secret Note",
    "content": "This is encrypted!"
  }'

# List notes
curl "http://localhost:2583/xrpc/app.plugin.encryptedStorage.listNotes?did=did:plc:example"
```

### Running with Docker and Sidecars

1. Build and start services:
```bash
cd packages/pds
docker-compose -f docker-compose.plugins.yml up --build
```

2. The configuration includes:
   - PDS server on port 2583
   - Python sidecar on port 3001

3. Test the sidecar:
```bash
# Check sidecar health
curl http://localhost:3001/health

# Call via plugin
curl http://localhost:2583/xrpc/app.plugin.sidecar.health
```

## Plugin Development

### Creating a New Plugin

1. Create a new TypeScript file:
```typescript
import { BasePlugin, PluginContext } from '@atproto/pds/plugin'

export class MyPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0'
    })
  }

  async onInit(ctx: PluginContext) {
    // Initialize
  }

  async onStart(ctx: PluginContext) {
    // Register endpoints, start tasks
  }
}

export default (config) => new MyPlugin()
```

2. Add to `plugins-config.json`:
```json
{
  "id": "my-plugin",
  "source": {
    "type": "local",
    "path": "./my-plugin.js"
  },
  "config": {
    "enabled": true
  }
}
```

### Creating a Sidecar Plugin

1. Implement the sidecar protocol:
   - `GET /health` - Health check
   - `POST /rpc` - Handle requests and events

2. Create a Dockerfile:
```dockerfile
FROM your-base-image

# Copy your code
COPY . /app

# Expose port
EXPOSE 3001

# Run server
CMD ["./your-server"]
```

3. Add to `docker-compose.yml`:
```yaml
my-sidecar:
  build: ./my-sidecar
  ports:
    - "3001:3001"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
```

## Configuration Reference

### Plugin Configuration Options

```typescript
{
  "id": "plugin-id",              // Unique identifier
  "source": {
    "type": "npm" | "local",      // npm package or local file
    "path": "package-name"        // Package name or file path
  },
  "config": {
    "enabled": true,              // Enable/disable plugin
    "sidecar": false,             // Run as sidecar
    "sidecarConfig": {            // Sidecar configuration
      "method": "http",           // http, unix, or grpc
      "connection": {
        "url": "http://localhost:3001"
      },
      "healthCheck": {
        "enabled": true,
        "interval": 30000,        // ms
        "timeout": 5000           // ms
      }
    },
    "config": {                   // Plugin-specific config
      "customOption": "value"
    }
  }
}
```

## Troubleshooting

### Common Issues

#### Plugin Not Loading
- Check that `PDS_PLUGINS_ENABLED=true`
- Verify the plugin path is correct
- Check for TypeScript compilation errors
- Review server logs

#### Sidecar Connection Errors
- Ensure sidecar is running
- Check network connectivity
- Verify health endpoint works
- Review sidecar logs

#### Encryption Errors
- Ensure SQLcipher support is compiled into better-sqlite3
- Verify `PLUGIN_ENCRYPTION_KEY` is set
- Check database file permissions

### Debugging

Enable detailed logging:
```bash
LOG_LEVEL=debug
LOG_ENABLED=1
```

Check plugin status:
```bash
# From within the plugin
ctx.logger.info('Debug message', { data: value })

# Check PDS logs
docker-compose logs pds

# Check sidecar logs
docker-compose logs plugin-sidecar-python
```

## Advanced Topics

### Database Migrations

```typescript
private getMigrations(): PluginMigration[] {
  return [
    {
      id: '001',
      name: 'initial_schema',
      up: (db) => {
        db.exec('CREATE TABLE ...')
      },
      down: (db) => {
        db.exec('DROP TABLE ...')
      }
    },
    {
      id: '002',
      name: 'add_index',
      up: (db) => {
        db.exec('CREATE INDEX ...')
      }
    }
  ]
}
```

### Event Processing

```typescript
async onRepoEvent(ctx: PluginContext, event: RepoEvent) {
  if (event.type === 'commit' && event.commit) {
    const { operation, collection, rkey, record } = event.commit

    switch (operation) {
      case 'create':
        await this.handleCreate(event.did, collection, rkey, record)
        break
      case 'update':
        await this.handleUpdate(event.did, collection, rkey, record)
        break
      case 'delete':
        await this.handleDelete(event.did, collection, rkey)
        break
    }
  }
}
```

### Custom XRPC Methods

```typescript
async onStart(ctx: PluginContext) {
  ctx.xrpcServer.method('com.example.myMethod', {
    auth: ctx.appContext.authVerifier.standard,
    rateLimit: {
      durationMs: 60000,
      points: 100
    },
    handler: async ({ input, auth }) => {
      // Validate input
      // Process request
      // Return response
      return { success: true, data: result }
    }
  })
}
```

## Resources

- [Plugin System Documentation](./PLUGINS.md)
- [AT Protocol Documentation](https://atproto.com)
- [PDS Source Code](../../packages/pds/src)

## Contributing

We welcome contributions! To contribute:

1. Create a new example
2. Document it thoroughly
3. Test it works
4. Submit a PR

## License

Same as the AT Protocol repository.
