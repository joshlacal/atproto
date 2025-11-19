import { Express } from 'express'
import { Database as SqliteDb } from 'better-sqlite3'
import { Server as XrpcServer } from '@atproto/xrpc-server'
import type { AppContext } from '../context.js'
import type { ServerConfig } from '../config/config.js'

/**
 * Plugin lifecycle states
 */
export enum PluginState {
  Uninitialized = 'uninitialized',
  Initializing = 'initializing',
  Initialized = 'initialized',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Destroyed = 'destroyed',
  Error = 'error',
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  /** Unique identifier for the plugin */
  id: string
  /** Display name */
  name: string
  /** Plugin version */
  version: string
  /** Description */
  description?: string
  /** Plugin author */
  author?: string
  /** Plugin dependencies (other plugin IDs) */
  dependencies?: string[]
}

/**
 * Plugin configuration options
 */
export interface PluginConfig {
  /** Whether the plugin is enabled */
  enabled?: boolean
  /** Plugin-specific configuration */
  config?: Record<string, unknown>
  /** Whether to run as a sidecar */
  sidecar?: boolean
  /** Sidecar configuration */
  sidecarConfig?: SidecarConfig
}

/**
 * Sidecar configuration
 */
export interface SidecarConfig {
  /** Communication method */
  method: 'http' | 'unix' | 'grpc'
  /** Connection details */
  connection: {
    /** For HTTP: URL */
    url?: string
    /** For Unix: socket path */
    socketPath?: string
    /** For gRPC: host and port */
    host?: string
    port?: number
  }
  /** Health check configuration */
  healthCheck?: {
    enabled: boolean
    interval?: number // ms
    timeout?: number // ms
  }
}

/**
 * Storage options for plugins
 */
export interface PluginStorageOptions {
  /** Storage type */
  type: 'sqlite' | 'sqlcipher'
  /** Database file path (relative to plugin data directory) */
  path: string
  /** Encryption key (for sqlcipher) */
  encryptionKey?: string
  /** SQLite pragmas */
  pragmas?: Record<string, string | number>
}

/**
 * Plugin context - provides access to PDS services and APIs
 */
export interface PluginContext {
  /** Plugin metadata */
  readonly metadata: PluginMetadata
  /** Plugin configuration */
  readonly config: PluginConfig
  /** PDS application context */
  readonly appContext: AppContext
  /** PDS server configuration */
  readonly serverConfig: ServerConfig
  /** Plugin data directory */
  readonly dataDir: string
  /** Logger scoped to this plugin */
  readonly logger: PluginLogger
  /** Storage factory */
  readonly storage: PluginStorageFactory
  /** Event emitter for plugin events */
  readonly events: PluginEventEmitter
  /** HTTP server for registering routes */
  readonly httpServer: Express
  /** XRPC server for registering XRPC methods */
  readonly xrpcServer: XrpcServer
}

/**
 * Plugin storage factory
 */
export interface PluginStorageFactory {
  /**
   * Create a new database connection
   */
  createDatabase(options: PluginStorageOptions): Promise<PluginDatabase>

  /**
   * Get the plugin's primary database
   */
  getPrimaryDatabase(): Promise<PluginDatabase>
}

/**
 * Plugin database wrapper
 */
export interface PluginDatabase {
  /** Raw SQLite/SQLcipher database instance */
  readonly db: SqliteDb
  /** Database path */
  readonly path: string
  /** Whether encryption is enabled */
  readonly encrypted: boolean
  /** Execute a query */
  exec(sql: string): void
  /** Prepare a statement */
  prepare(sql: string): any
  /** Close the database */
  close(): void
  /** Run migrations */
  migrate(migrations: PluginMigration[]): Promise<void>
}

/**
 * Plugin migration
 */
export interface PluginMigration {
  /** Migration version/ID */
  id: string
  /** Migration name */
  name: string
  /** Up migration */
  up: (db: PluginDatabase) => Promise<void> | void
  /** Down migration (optional) */
  down?: (db: PluginDatabase) => Promise<void> | void
}

/**
 * Plugin logger interface
 */
export interface PluginLogger {
  trace(message: string, meta?: object): void
  debug(message: string, meta?: object): void
  info(message: string, meta?: object): void
  warn(message: string, meta?: object): void
  error(message: string | Error, meta?: object): void
}

/**
 * Plugin event emitter
 */
export interface PluginEventEmitter {
  /** Emit an event */
  emit(event: string, data?: unknown): void
  /** Listen to an event */
  on(event: string, handler: (data: unknown) => void): void
  /** Remove event listener */
  off(event: string, handler: (data: unknown) => void): void
}

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
  /**
   * Called when the plugin is initialized
   * Use this to set up configuration, validate dependencies, etc.
   */
  onInit?(ctx: PluginContext): Promise<void> | void

  /**
   * Called when the PDS server is starting
   * Use this to start background tasks, register routes, etc.
   */
  onStart?(ctx: PluginContext): Promise<void> | void

  /**
   * Called when the PDS server is stopping
   * Use this to clean up resources, flush data, etc.
   */
  onStop?(ctx: PluginContext): Promise<void> | void

  /**
   * Called when the plugin is being destroyed
   * Use this to close connections, remove temporary files, etc.
   */
  onDestroy?(ctx: PluginContext): Promise<void> | void

  /**
   * Called on each HTTP request (optional middleware)
   */
  onRequest?(
    req: Express.Request,
    res: Express.Response,
    next: Express.NextFunction,
  ): void

  /**
   * Called when a repository event occurs
   */
  onRepoEvent?(ctx: PluginContext, event: RepoEvent): Promise<void> | void

  /**
   * Called when an account event occurs
   */
  onAccountEvent?(ctx: PluginContext, event: AccountEvent): Promise<void> | void

  /**
   * Called when an identity event occurs
   */
  onIdentityEvent?(
    ctx: PluginContext,
    event: IdentityEvent,
  ): Promise<void> | void
}

/**
 * Repository event
 */
export interface RepoEvent {
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
    record?: Record<string, unknown>
  }
}

/**
 * Account event
 */
export interface AccountEvent {
  type: 'create' | 'delete' | 'update'
  did: string
  handle?: string
  email?: string
}

/**
 * Identity event
 */
export interface IdentityEvent {
  type: 'plc_operation'
  did: string
  operation: Record<string, unknown>
}

/**
 * Main plugin interface
 */
export interface Plugin extends PluginHooks {
  /** Plugin metadata */
  readonly metadata: PluginMetadata

  /** Current plugin state */
  readonly state: PluginState

  /**
   * Initialize the plugin
   */
  init(ctx: PluginContext): Promise<void>

  /**
   * Start the plugin
   */
  start(ctx: PluginContext): Promise<void>

  /**
   * Stop the plugin
   */
  stop(ctx: PluginContext): Promise<void>

  /**
   * Destroy the plugin
   */
  destroy(ctx: PluginContext): Promise<void>
}

/**
 * Plugin factory function
 */
export type PluginFactory = (config?: PluginConfig) => Plugin

/**
 * Plugin module export
 */
export interface PluginModule {
  default?: PluginFactory
  plugin?: PluginFactory
  createPlugin?: PluginFactory
}

/**
 * Plugin registration options
 */
export interface PluginRegistration {
  /** Plugin ID */
  id: string
  /** Plugin factory or instance */
  plugin: Plugin | PluginFactory
  /** Plugin configuration */
  config?: PluginConfig
  /** Load from npm package or local path */
  source?: {
    type: 'npm' | 'local'
    path: string
  }
}
