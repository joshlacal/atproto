import { Express } from 'express'
import { Server as XrpcServer } from '@atproto/xrpc-server'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import {
  Plugin,
  PluginFactory,
  PluginConfig,
  PluginRegistration,
  PluginModule,
  PluginState,
  RepoEvent,
  AccountEvent,
  IdentityEvent,
} from './types.js'
import { PluginContextImpl } from './context.js'
import type { AppContext } from '../context.js'
import type { ServerConfig } from '../config/config.js'

/**
 * Plugin manager - handles plugin lifecycle and coordination
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private contexts: Map<string, PluginContextImpl> = new Map()
  private loadOrder: string[] = []
  private logger: any

  constructor(
    private readonly appContext: AppContext,
    private readonly serverConfig: ServerConfig,
    private readonly httpServer: Express,
    private readonly xrpcServer: XrpcServer,
    private readonly pluginDataDir: string,
  ) {
    this.logger = appContext.logger || console
  }

  /**
   * Register a plugin
   */
  async register(registration: PluginRegistration): Promise<void> {
    const { id, plugin, config = { enabled: true } } = registration

    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already registered`)
    }

    if (!config.enabled) {
      this.logger.info(`Plugin ${id} is disabled, skipping registration`)
      return
    }

    this.logger.info(`Registering plugin: ${id}`)

    // Load plugin if from source
    let pluginInstance: Plugin
    if (registration.source) {
      pluginInstance = await this.loadPluginFromSource(registration)
    } else if (typeof plugin === 'function') {
      pluginInstance = plugin(config)
    } else {
      pluginInstance = plugin
    }

    // Validate plugin metadata
    if (!pluginInstance.metadata) {
      throw new Error(`Plugin ${id} does not have metadata`)
    }

    // Check dependencies
    if (pluginInstance.metadata.dependencies) {
      for (const depId of pluginInstance.metadata.dependencies) {
        if (!this.plugins.has(depId)) {
          throw new Error(
            `Plugin ${id} depends on ${depId}, which is not registered`,
          )
        }
      }
    }

    // Create plugin data directory
    const dataDir = join(this.pluginDataDir, id)
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true })
    }

    // Create plugin context
    const context = new PluginContextImpl(
      pluginInstance.metadata,
      config,
      this.appContext,
      this.serverConfig,
      dataDir,
      this.httpServer,
      this.xrpcServer,
    )

    this.plugins.set(id, pluginInstance)
    this.contexts.set(id, context)
    this.loadOrder.push(id)

    this.logger.info(`Plugin registered: ${id}`)
  }

  /**
   * Load plugin from source (npm or local path)
   */
  private async loadPluginFromSource(
    registration: PluginRegistration,
  ): Promise<Plugin> {
    if (!registration.source) {
      throw new Error('No source specified')
    }

    const { type, path } = registration.source

    let modulePath: string
    if (type === 'npm') {
      // Load from node_modules
      modulePath = path
    } else {
      // Load from local path
      modulePath = pathToFileURL(path).href
    }

    this.logger.debug(`Loading plugin from: ${modulePath}`)

    try {
      const module = (await import(modulePath)) as PluginModule

      // Try different export patterns
      const factory =
        module.default || module.plugin || module.createPlugin

      if (!factory || typeof factory !== 'function') {
        throw new Error(
          `Plugin module does not export a valid factory function`,
        )
      }

      return factory(registration.config)
    } catch (error) {
      this.logger.error(`Failed to load plugin from ${modulePath}`, { error })
      throw error
    }
  }

  /**
   * Initialize all plugins
   */
  async initAll(): Promise<void> {
    this.logger.info('Initializing plugins...')

    for (const id of this.loadOrder) {
      const plugin = this.plugins.get(id)!
      const context = this.contexts.get(id)!

      try {
        await plugin.init(context)
      } catch (error) {
        this.logger.error(`Failed to initialize plugin: ${id}`, { error })
        throw error
      }
    }

    this.logger.info(`Initialized ${this.loadOrder.length} plugin(s)`)
  }

  /**
   * Start all plugins
   */
  async startAll(): Promise<void> {
    this.logger.info('Starting plugins...')

    for (const id of this.loadOrder) {
      const plugin = this.plugins.get(id)!
      const context = this.contexts.get(id)!

      try {
        await plugin.start(context)
      } catch (error) {
        this.logger.error(`Failed to start plugin: ${id}`, { error })
        throw error
      }
    }

    this.logger.info(`Started ${this.loadOrder.length} plugin(s)`)

    // Set up event listeners
    this.setupEventListeners()
  }

  /**
   * Stop all plugins
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping plugins...')

    // Stop in reverse order
    for (const id of [...this.loadOrder].reverse()) {
      const plugin = this.plugins.get(id)!
      const context = this.contexts.get(id)!

      try {
        await plugin.stop(context)
      } catch (error) {
        this.logger.error(`Failed to stop plugin: ${id}`, { error })
        // Continue stopping other plugins
      }
    }

    this.logger.info('All plugins stopped')
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    this.logger.info('Destroying plugins...')

    // Destroy in reverse order
    for (const id of [...this.loadOrder].reverse()) {
      const plugin = this.plugins.get(id)!
      const context = this.contexts.get(id)!

      try {
        await plugin.destroy(context)
        await context.destroy()
      } catch (error) {
        this.logger.error(`Failed to destroy plugin: ${id}`, { error })
        // Continue destroying other plugins
      }
    }

    this.plugins.clear()
    this.contexts.clear()
    this.loadOrder = []

    this.logger.info('All plugins destroyed')
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * Get plugin context by ID
   */
  getContext(id: string): PluginContextImpl | undefined {
    return this.contexts.get(id)
  }

  /**
   * Get all plugins
   */
  getAllPlugins(): Map<string, Plugin> {
    return new Map(this.plugins)
  }

  /**
   * Get plugin states
   */
  getPluginStates(): Record<string, PluginState> {
    const states: Record<string, PluginState> = {}
    for (const [id, plugin] of this.plugins) {
      states[id] = plugin.state
    }
    return states
  }

  /**
   * Set up event listeners for plugins
   */
  private setupEventListeners(): void {
    // Listen to sequencer events and forward to plugins
    if (this.appContext.sequencer) {
      // Repo events
      this.appContext.sequencer.on('commit', (evt) => {
        const repoEvent: RepoEvent = {
          type: 'commit',
          seq: evt.seq,
          time: evt.time,
          did: evt.did,
          commit: evt.commit
            ? {
                cid: evt.commit.cid,
                rev: evt.commit.rev,
                operation: evt.commit.operation as any,
                collection: evt.commit.collection,
                rkey: evt.commit.rkey,
                record: evt.commit.record,
              }
            : undefined,
        }
        this.emitRepoEvent(repoEvent)
      })

      // Account events
      this.appContext.sequencer.on('account', (evt) => {
        const accountEvent: AccountEvent = {
          type: evt.type as any,
          did: evt.did,
          handle: evt.handle,
        }
        this.emitAccountEvent(accountEvent)
      })

      // Identity events
      this.appContext.sequencer.on('identity', (evt) => {
        const identityEvent: IdentityEvent = {
          type: 'plc_operation',
          did: evt.did,
          operation: evt.operation || {},
        }
        this.emitIdentityEvent(identityEvent)
      })
    }
  }

  /**
   * Emit repo event to all plugins
   */
  private emitRepoEvent(event: RepoEvent): void {
    for (const [id, plugin] of this.plugins) {
      if (plugin.onRepoEvent && plugin.state === PluginState.Started) {
        const context = this.contexts.get(id)!
        try {
          plugin.onRepoEvent(context, event)
        } catch (error) {
          this.logger.error(`Plugin ${id} error handling repo event`, {
            error,
          })
        }
      }
    }
  }

  /**
   * Emit account event to all plugins
   */
  private emitAccountEvent(event: AccountEvent): void {
    for (const [id, plugin] of this.plugins) {
      if (plugin.onAccountEvent && plugin.state === PluginState.Started) {
        const context = this.contexts.get(id)!
        try {
          plugin.onAccountEvent(context, event)
        } catch (error) {
          this.logger.error(`Plugin ${id} error handling account event`, {
            error,
          })
        }
      }
    }
  }

  /**
   * Emit identity event to all plugins
   */
  private emitIdentityEvent(event: IdentityEvent): void {
    for (const [id, plugin] of this.plugins) {
      if (plugin.onIdentityEvent && plugin.state === PluginState.Started) {
        const context = this.contexts.get(id)!
        try {
          plugin.onIdentityEvent(context, event)
        } catch (error) {
          this.logger.error(`Plugin ${id} error handling identity event`, {
            error,
          })
        }
      }
    }
  }

  /**
   * Get Express middleware for request handling
   */
  getRequestMiddleware(): Express.RequestHandler {
    return (req, res, next) => {
      // Call onRequest for each plugin
      for (const [id, plugin] of this.plugins) {
        if (plugin.onRequest && plugin.state === PluginState.Started) {
          try {
            plugin.onRequest(req, res, next)
          } catch (error) {
            this.logger.error(`Plugin ${id} error handling request`, { error })
          }
        }
      }
      next()
    }
  }
}
