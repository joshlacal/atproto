/**
 * PDS Plugin System
 *
 * This module provides a plugin system for the Personal Data Server (PDS)
 * that allows extending the server with custom functionality.
 *
 * Features:
 * - Plugin lifecycle management (init, start, stop, destroy)
 * - Event hooks for repo, account, and identity events
 * - Custom API endpoints via Express and XRPC
 * - Encrypted storage with SQLcipher support
 * - Sidecar plugin support for polyglot plugins
 * - Plugin dependency management
 *
 * @example
 * ```typescript
 * import { BasePlugin, PluginContext } from '@atproto/pds/plugin'
 *
 * class MyPlugin extends BasePlugin {
 *   async onInit(ctx: PluginContext) {
 *     // Initialize plugin
 *     const db = await ctx.storage.createDatabase({
 *       type: 'sqlcipher',
 *       path: 'encrypted.db',
 *       encryptionKey: process.env.ENCRYPTION_KEY
 *     })
 *   }
 *
 *   async onStart(ctx: PluginContext) {
 *     // Register custom API endpoint
 *     ctx.httpServer.get('/my-plugin/hello', (req, res) => {
 *       res.json({ message: 'Hello from my plugin!' })
 *     })
 *   }
 *
 *   async onRepoEvent(ctx: PluginContext, event: RepoEvent) {
 *     // Handle repository events
 *     ctx.logger.info('Repo event:', event)
 *   }
 * }
 *
 * export default (config) => new MyPlugin({
 *   id: 'my-plugin',
 *   name: 'My Plugin',
 *   version: '1.0.0'
 * })
 * ```
 */

// Core types
export type {
  Plugin,
  PluginFactory,
  PluginMetadata,
  PluginConfig,
  PluginContext,
  PluginHooks,
  PluginRegistration,
  PluginModule,
  PluginDatabase,
  PluginMigration,
  PluginLogger,
  PluginEventEmitter,
  PluginStorageFactory,
  PluginStorageOptions,
  RepoEvent,
  AccountEvent,
  IdentityEvent,
  SidecarConfig,
} from './types.js'

export { PluginState } from './types.js'

// Base classes
export { BasePlugin } from './base-plugin.js'

// Plugin manager
export { PluginManager } from './manager.js'

// Context and storage
export { PluginContextImpl } from './context.js'
export {
  PluginDatabaseImpl,
  PluginStorageFactoryImpl,
} from './storage.js'

// Sidecar support
export {
  SidecarClient,
  SidecarServer,
  SidecarMessageType,
  type SidecarMessage,
} from './sidecar.js'
