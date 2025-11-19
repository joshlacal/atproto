/**
 * Example Plugin: Sidecar Plugin
 *
 * This plugin demonstrates how to:
 * 1. Run plugin logic in a sidecar process
 * 2. Communicate between PDS and sidecar via HTTP/Unix sockets
 * 3. Implement health checks
 * 4. Handle plugin events in a sidecar
 *
 * This allows you to write plugins in any language (Python, Go, Rust, etc.)
 * as long as they implement the sidecar protocol.
 */

import {
  BasePlugin,
  PluginContext,
  PluginConfig,
  RepoEvent,
  AccountEvent,
  SidecarClient,
} from './src/plugin/index.js'

export class SidecarExamplePlugin extends BasePlugin {
  private sidecar?: SidecarClient

  constructor() {
    super({
      id: 'sidecar-example',
      name: 'Sidecar Example Plugin',
      version: '1.0.0',
      description: 'Demonstrates sidecar plugin communication',
      author: 'AT Protocol',
    })
  }

  protected async onInit(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing sidecar plugin')

    // Check if running as sidecar
    if (!ctx.config.sidecar) {
      ctx.logger.warn(
        'Plugin not configured as sidecar, will run in-process',
      )
      return
    }

    // Create sidecar client
    this.sidecar = new SidecarClient(
      this.metadata.id,
      ctx.config.sidecarConfig!,
    )

    // Listen to sidecar events
    this.sidecar.on('connected', () => {
      ctx.logger.info('Connected to sidecar')
    })

    this.sidecar.on('disconnected', () => {
      ctx.logger.warn('Disconnected from sidecar')
    })

    this.sidecar.on('health-check-failed', (error) => {
      ctx.logger.error('Sidecar health check failed', { error })
    })

    // Connect to sidecar
    await this.sidecar.connect()

    // Initialize sidecar
    const result = await this.sidecar.request('initialize', {
      pluginId: this.metadata.id,
      config: ctx.config.config,
    })

    ctx.logger.info('Sidecar initialized', { result })
  }

  protected async onStart(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting sidecar plugin')

    if (this.sidecar) {
      await this.sidecar.request('start')
    }

    // Register API endpoints that proxy to sidecar
    this.registerApiEndpoints(ctx)
  }

  protected async onStop(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Stopping sidecar plugin')

    if (this.sidecar) {
      await this.sidecar.request('stop')
    }
  }

  protected async onDestroy(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Destroying sidecar plugin')

    if (this.sidecar) {
      await this.sidecar.request('destroy')
      await this.sidecar.disconnect()
    }
  }

  // Forward repository events to sidecar
  async onRepoEvent(ctx: PluginContext, event: RepoEvent): Promise<void> {
    if (this.sidecar && this.sidecar.isConnected()) {
      try {
        await this.sidecar.sendEvent('repo', event)
      } catch (error) {
        ctx.logger.error('Failed to send repo event to sidecar', { error })
      }
    }
  }

  // Forward account events to sidecar
  async onAccountEvent(
    ctx: PluginContext,
    event: AccountEvent,
  ): Promise<void> {
    if (this.sidecar && this.sidecar.isConnected()) {
      try {
        await this.sidecar.sendEvent('account', event)
      } catch (error) {
        ctx.logger.error('Failed to send account event to sidecar', {
          error,
        })
      }
    }
  }

  /**
   * Register API endpoints that proxy to sidecar
   */
  private registerApiEndpoints(ctx: PluginContext): void {
    const apiPrefix = '/xrpc/app.plugin.sidecar'

    // Generic RPC endpoint
    ctx.httpServer.post(`${apiPrefix}.rpc`, async (req, res) => {
      try {
        if (!this.sidecar) {
          return res.status(503).json({ error: 'Sidecar not available' })
        }

        const { method, params } = req.body

        if (!method) {
          return res.status(400).json({ error: 'Missing method' })
        }

        const result = await this.sidecar.request(method, params)
        res.json({ result })
      } catch (error) {
        ctx.logger.error('Sidecar RPC failed', { error })
        res.status(500).json({
          error: error instanceof Error ? error.message : 'RPC failed',
        })
      }
    })

    // Health check endpoint
    ctx.httpServer.get(`${apiPrefix}.health`, async (req, res) => {
      try {
        if (!this.sidecar) {
          return res.json({
            status: 'in-process',
            plugin: this.metadata.name,
            version: this.metadata.version,
          })
        }

        const sidecarHealth = await this.sidecar.request('health')
        res.json({
          status: 'ok',
          plugin: this.metadata.name,
          version: this.metadata.version,
          sidecar: sidecarHealth,
        })
      } catch (error) {
        res.status(503).json({
          status: 'error',
          error: error instanceof Error ? error.message : 'Health check failed',
        })
      }
    })
  }
}

// Export plugin factory
export default function createPlugin(config?: PluginConfig) {
  return new SidecarExamplePlugin()
}
