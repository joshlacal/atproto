# PDS Plugin System

The Personal Data Server (PDS) plugin system allows you to extend the server with custom functionality, including:

- Custom application logic
- Private encrypted data storage with SQLcipher
- Custom API endpoints
- Event-driven processing
- Sidecar plugins in any language

## Table of Contents

- [Quick Start](#quick-start)
- [Plugin Development](#plugin-development)
- [Encrypted Storage](#encrypted-storage)
- [Sidecar Plugins](#sidecar-plugins)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Quick Start

### Enable Plugins

Set the following environment variables:

```bash
PDS_PLUGINS_ENABLED=true
PDS_PLUGINS_DATA_DIRECTORY=/path/to/plugin/data
PDS_PLUGINS_CONFIG=/path/to/plugins-config.json
```

### Create a Plugin Configuration File

Create `plugins-config.json`:

```json
[
  {
    "id": "my-plugin",
    "source": {
      "type": "npm",
      "path": "@my-org/pds-plugin-example"
    },
    "config": {
      "enabled": true,
      "config": {
        "customOption": "value"
      }
    }
  }
]
```

### Create Your First Plugin

```typescript
import { BasePlugin, PluginContext } from '@atproto/pds/plugin'

export class MyPlugin extends BasePlugin {
  constructor() {
    super({
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      description: 'My first PDS plugin'
    })
  }

  async onInit(ctx: PluginContext) {
    ctx.logger.info('Plugin initialized!')
  }

  async onStart(ctx: PluginContext) {
    // Register a custom API endpoint
    ctx.httpServer.get('/my-plugin/hello', (req, res) => {
      res.json({ message: 'Hello from my plugin!' })
    })
  }
}

export default (config) => new MyPlugin()
```

## Plugin Development

### Plugin Lifecycle

Plugins have four lifecycle stages:

1. **Init** - Initialize configuration, set up storage, validate dependencies
2. **Start** - Register API endpoints, start background tasks, connect to external services
3. **Stop** - Clean up resources, flush data, close connections
4. **Destroy** - Final cleanup, remove temporary files

```typescript
class MyPlugin extends BasePlugin {
  async onInit(ctx: PluginContext) {
    // Called once during server startup
    // Set up configuration and dependencies
  }

  async onStart(ctx: PluginContext) {
    // Called when the server starts
    // Register routes, start tasks
  }

  async onStop(ctx: PluginContext) {
    // Called when the server is stopping
    // Clean up gracefully
  }

  async onDestroy(ctx: PluginContext) {
    // Called when the plugin is being destroyed
    // Final cleanup
  }
}
```

### Event Hooks

Listen to PDS events:

```typescript
class MyPlugin extends BasePlugin {
  async onRepoEvent(ctx: PluginContext, event: RepoEvent) {
    if (event.type === 'commit') {
      ctx.logger.info('New commit:', event.commit)
    }
  }

  async onAccountEvent(ctx: PluginContext, event: AccountEvent) {
    if (event.type === 'create') {
      ctx.logger.info('New account:', event.did)
    }
  }

  async onIdentityEvent(ctx: PluginContext, event: IdentityEvent) {
    ctx.logger.info('Identity event:', event)
  }
}
```

### Custom API Endpoints

Plugins can register custom HTTP endpoints and XRPC methods:

```typescript
async onStart(ctx: PluginContext) {
  // HTTP endpoint
  ctx.httpServer.post('/my-plugin/api', async (req, res) => {
    res.json({ data: 'response' })
  })

  // XRPC method
  ctx.xrpcServer.method('com.example.myMethod', {
    auth: ctx.appContext.authVerifier.standard,
    handler: async ({ input, auth }) => {
      return { success: true }
    }
  })
}
```

### Plugin Context

The `PluginContext` provides access to PDS services:

```typescript
interface PluginContext {
  // Plugin metadata and configuration
  metadata: PluginMetadata
  config: PluginConfig

  // PDS application context
  appContext: AppContext
  serverConfig: ServerConfig

  // Plugin-specific resources
  dataDir: string            // Plugin data directory
  logger: PluginLogger       // Scoped logger
  storage: StorageFactory    // Database factory
  events: EventEmitter       // Plugin event emitter

  // Server instances
  httpServer: Express        // HTTP server
  xrpcServer: XrpcServer    // XRPC server
}
```

## Encrypted Storage

### SQLcipher Support

Plugins can create encrypted databases using SQLcipher:

```typescript
async onInit(ctx: PluginContext) {
  const db = await ctx.storage.createDatabase({
    type: 'sqlcipher',
    path: 'encrypted.db',
    encryptionKey: process.env.ENCRYPTION_KEY
  })

  // Run migrations
  await db.migrate([
    {
      id: '001',
      name: 'create_table',
      up: (db) => {
        db.exec(`
          CREATE TABLE secrets (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
          )
        `)
      }
    }
  ])
}
```

### Database Operations

```typescript
// Insert data
db.prepare('INSERT INTO secrets (id, data) VALUES (?, ?)')
  .run('key1', 'secret-value')

// Query data
const result = db.prepare('SELECT * FROM secrets WHERE id = ?')
  .get('key1')

// Transactions
const transaction = db.db.transaction(() => {
  db.prepare('INSERT INTO secrets (id, data) VALUES (?, ?)').run('key2', 'value2')
  db.prepare('INSERT INTO secrets (id, data) VALUES (?, ?)').run('key3', 'value3')
})
transaction()
```

### Multiple Databases

```typescript
// Create multiple databases for different purposes
const userDb = await ctx.storage.createDatabase({
  type: 'sqlcipher',
  path: 'users.db',
  encryptionKey: process.env.USER_DB_KEY
})

const sessionDb = await ctx.storage.createDatabase({
  type: 'sqlite',  // Non-encrypted for less sensitive data
  path: 'sessions.db'
})
```

## Sidecar Plugins

Sidecar plugins run in separate processes and can be written in any language.

### Benefits of Sidecars

- **Language Flexibility** - Use Python, Go, Rust, etc.
- **Isolation** - Crashes don't affect the main PDS
- **Scalability** - Scale plugins independently
- **Resource Management** - Better memory/CPU isolation

### TypeScript Sidecar Client

```typescript
class MySidecarPlugin extends BasePlugin {
  private sidecar?: SidecarClient

  async onInit(ctx: PluginContext) {
    this.sidecar = new SidecarClient(this.metadata.id, {
      method: 'http',
      connection: {
        url: 'http://localhost:3001'
      },
      healthCheck: {
        enabled: true,
        interval: 30000
      }
    })

    await this.sidecar.connect()
    await this.sidecar.request('initialize', { config: ctx.config })
  }

  async onRepoEvent(ctx: PluginContext, event: RepoEvent) {
    await this.sidecar?.sendEvent('repo', event)
  }
}
```

### Sidecar Server Protocol

Sidecar servers must implement these endpoints:

#### `/health` (GET)
Health check endpoint

```json
{
  "status": "ok",
  "timestamp": 1234567890
}
```

#### `/rpc` (POST)
RPC endpoint for method calls and events

Request:
```json
{
  "type": "request",
  "id": "unique-id",
  "method": "methodName",
  "params": { "key": "value" }
}
```

Response:
```json
{
  "type": "response",
  "id": "unique-id",
  "result": { "data": "value" }
}
```

Event:
```json
{
  "type": "event",
  "event": "repo",
  "data": { "type": "commit", "did": "..." }
}
```

### Python Example

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

@app.route('/rpc', methods=['POST'])
def rpc():
    message = request.json

    if message['type'] == 'request':
        method = message['method']
        params = message.get('params', {})

        # Handle methods
        if method == 'initialize':
            # Initialize plugin
            return jsonify({
                'type': 'response',
                'id': message['id'],
                'result': {'success': True}
            })

    elif message['type'] == 'event':
        event = message['event']
        data = message['data']
        # Process event
        return jsonify({'type': 'response'})

if __name__ == '__main__':
    app.run(port=3001)
```

### Docker Sidecar Setup

```yaml
# docker-compose.yml
services:
  pds:
    image: your-pds-image
    environment:
      PDS_PLUGINS_ENABLED: "true"
      PDS_PLUGINS_CONFIG: /app/plugins.json
    depends_on:
      - my-sidecar

  my-sidecar:
    build: ./my-sidecar
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
```

## API Reference

### Plugin Metadata

```typescript
interface PluginMetadata {
  id: string              // Unique plugin identifier
  name: string           // Display name
  version: string        // Semantic version
  description?: string   // Plugin description
  author?: string        // Plugin author
  dependencies?: string[] // Other plugin IDs
}
```

### Plugin Configuration

```typescript
interface PluginConfig {
  enabled?: boolean      // Whether plugin is enabled
  config?: object        // Plugin-specific config
  sidecar?: boolean      // Run as sidecar
  sidecarConfig?: {
    method: 'http' | 'unix' | 'grpc'
    connection: {
      url?: string
      socketPath?: string
      host?: string
      port?: number
    }
    healthCheck?: {
      enabled: boolean
      interval?: number
      timeout?: number
    }
  }
}
```

### Events

#### RepoEvent
```typescript
interface RepoEvent {
  type: 'commit' | 'handle' | 'migrate' | 'tombstone'
  seq: number
  time: string
  did: string
  commit?: {
    cid: string
    rev: string
    operation: 'create' | 'update' | 'delete'
    collection: string
    rkey: string
    record?: object
  }
}
```

#### AccountEvent
```typescript
interface AccountEvent {
  type: 'create' | 'delete' | 'update'
  did: string
  handle?: string
  email?: string
}
```

## Examples

See the following example files:

- **`example-plugin-encrypted-storage.ts`** - Encrypted note storage with SQLcipher
- **`example-plugin-sidecar.ts`** - Sidecar plugin communication
- **`example-sidecar-server.py`** - Python sidecar implementation
- **`plugins-config.example.json`** - Plugin configuration
- **`docker-compose.plugins.yml`** - Docker setup with sidecars

## Best Practices

### Security

1. **Encrypt Sensitive Data** - Use SQLcipher for private user data
2. **Validate Input** - Always validate API endpoint inputs
3. **Use Secrets** - Store encryption keys in environment variables
4. **Isolate Sidecars** - Run untrusted code in sidecars

### Performance

1. **Use Transactions** - Batch database operations
2. **Index Queries** - Create indexes for frequently queried columns
3. **Async Operations** - Use async/await for I/O operations
4. **Resource Limits** - Set limits on sidecar resources

### Reliability

1. **Handle Errors** - Catch and log errors gracefully
2. **Health Checks** - Implement health checks for sidecars
3. **Graceful Shutdown** - Clean up resources in `onStop` and `onDestroy`
4. **Dependencies** - Declare plugin dependencies explicitly

### Development

1. **Version Plugins** - Use semantic versioning
2. **Test Thoroughly** - Write tests for plugins
3. **Document APIs** - Document custom endpoints
4. **Log Appropriately** - Use plugin logger with appropriate levels

## Troubleshooting

### Plugin Not Loading

- Check `PDS_PLUGINS_ENABLED=true`
- Verify plugin configuration path
- Check plugin factory exports
- Review logs for errors

### Sidecar Not Connecting

- Verify sidecar is running (`docker-compose ps`)
- Check health endpoint is responding
- Verify network connectivity
- Review sidecar logs

### Database Encryption Issues

- Ensure SQLcipher support is compiled
- Verify encryption key is set
- Check database file permissions
- Review migration logs

## Contributing

To contribute to the plugin system:

1. Review the plugin architecture
2. Follow TypeScript best practices
3. Add tests for new features
4. Update documentation
5. Submit a pull request

## License

Same as the main AT Protocol repository.
