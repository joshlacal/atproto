import { Express } from 'express'
import { Server as XrpcServer } from '@atproto/xrpc-server'
import { EventEmitter } from 'events'
import {
  PluginContext,
  PluginMetadata,
  PluginConfig,
  PluginLogger,
  PluginEventEmitter,
  PluginStorageFactory,
} from './types.js'
import type { AppContext } from '../context.js'
import type { ServerConfig } from '../config/config.js'
import { PluginStorageFactoryImpl } from './storage.js'

/**
 * Plugin logger implementation
 */
export class PluginLoggerImpl implements PluginLogger {
  constructor(
    private readonly pluginId: string,
    private readonly baseLogger?: any,
  ) {}

  private formatMessage(message: string): string {
    return `[Plugin:${this.pluginId}] ${message}`
  }

  trace(message: string, meta?: object): void {
    if (this.baseLogger?.trace) {
      this.baseLogger.trace({ ...meta }, this.formatMessage(message))
    } else {
      console.trace(this.formatMessage(message), meta)
    }
  }

  debug(message: string, meta?: object): void {
    if (this.baseLogger?.debug) {
      this.baseLogger.debug({ ...meta }, this.formatMessage(message))
    } else {
      console.debug(this.formatMessage(message), meta)
    }
  }

  info(message: string, meta?: object): void {
    if (this.baseLogger?.info) {
      this.baseLogger.info({ ...meta }, this.formatMessage(message))
    } else {
      console.info(this.formatMessage(message), meta)
    }
  }

  warn(message: string, meta?: object): void {
    if (this.baseLogger?.warn) {
      this.baseLogger.warn({ ...meta }, this.formatMessage(message))
    } else {
      console.warn(this.formatMessage(message), meta)
    }
  }

  error(message: string | Error, meta?: object): void {
    const errorMessage =
      message instanceof Error ? message.message : message
    const errorMeta = message instanceof Error
      ? { ...meta, error: message }
      : meta

    if (this.baseLogger?.error) {
      this.baseLogger.error(errorMeta, this.formatMessage(errorMessage))
    } else {
      console.error(this.formatMessage(errorMessage), errorMeta)
    }
  }
}

/**
 * Plugin event emitter implementation
 */
export class PluginEventEmitterImpl implements PluginEventEmitter {
  private emitter = new EventEmitter()

  emit(event: string, data?: unknown): void {
    this.emitter.emit(event, data)
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.emitter.on(event, handler)
  }

  off(event: string, handler: (data: unknown) => void): void {
    this.emitter.off(event, handler)
  }
}

/**
 * Plugin context implementation
 */
export class PluginContextImpl implements PluginContext {
  public readonly logger: PluginLogger
  public readonly events: PluginEventEmitter
  public readonly storage: PluginStorageFactory

  constructor(
    public readonly metadata: PluginMetadata,
    public readonly config: PluginConfig,
    public readonly appContext: AppContext,
    public readonly serverConfig: ServerConfig,
    public readonly dataDir: string,
    public readonly httpServer: Express,
    public readonly xrpcServer: XrpcServer,
  ) {
    this.logger = new PluginLoggerImpl(
      metadata.id,
      appContext.logger || console,
    )
    this.events = new PluginEventEmitterImpl()
    this.storage = new PluginStorageFactoryImpl(dataDir)
  }

  async destroy(): Promise<void> {
    // Close all databases
    if (this.storage instanceof PluginStorageFactoryImpl) {
      await this.storage.closeAll()
    }
  }
}
