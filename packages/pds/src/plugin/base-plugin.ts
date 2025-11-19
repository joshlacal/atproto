import {
  Plugin,
  PluginMetadata,
  PluginState,
  PluginContext,
  PluginHooks,
} from './types.js'

/**
 * Base plugin class that provides default implementations
 * Custom plugins can extend this class to avoid implementing all methods
 */
export abstract class BasePlugin implements Plugin {
  private _state: PluginState = PluginState.Uninitialized

  constructor(public readonly metadata: PluginMetadata) {}

  get state(): PluginState {
    return this._state
  }

  protected setState(state: PluginState): void {
    this._state = state
  }

  async init(ctx: PluginContext): Promise<void> {
    this.setState(PluginState.Initializing)
    try {
      await this.onInit?.(ctx)
      this.setState(PluginState.Initialized)
      ctx.logger.info(`Plugin initialized: ${this.metadata.name}`)
    } catch (error) {
      this.setState(PluginState.Error)
      ctx.logger.error(`Failed to initialize plugin: ${this.metadata.name}`, {
        error,
      })
      throw error
    }
  }

  async start(ctx: PluginContext): Promise<void> {
    if (this._state !== PluginState.Initialized) {
      throw new Error(
        `Cannot start plugin ${this.metadata.name}: not initialized`,
      )
    }

    this.setState(PluginState.Starting)
    try {
      await this.onStart?.(ctx)
      this.setState(PluginState.Started)
      ctx.logger.info(`Plugin started: ${this.metadata.name}`)
    } catch (error) {
      this.setState(PluginState.Error)
      ctx.logger.error(`Failed to start plugin: ${this.metadata.name}`, {
        error,
      })
      throw error
    }
  }

  async stop(ctx: PluginContext): Promise<void> {
    if (this._state !== PluginState.Started) {
      return // Already stopped or never started
    }

    this.setState(PluginState.Stopping)
    try {
      await this.onStop?.(ctx)
      this.setState(PluginState.Stopped)
      ctx.logger.info(`Plugin stopped: ${this.metadata.name}`)
    } catch (error) {
      this.setState(PluginState.Error)
      ctx.logger.error(`Failed to stop plugin: ${this.metadata.name}`, {
        error,
      })
      throw error
    }
  }

  async destroy(ctx: PluginContext): Promise<void> {
    try {
      if (this._state === PluginState.Started) {
        await this.stop(ctx)
      }
      await this.onDestroy?.(ctx)
      this.setState(PluginState.Destroyed)
      ctx.logger.info(`Plugin destroyed: ${this.metadata.name}`)
    } catch (error) {
      this.setState(PluginState.Error)
      ctx.logger.error(`Failed to destroy plugin: ${this.metadata.name}`, {
        error,
      })
      throw error
    }
  }

  // Optional lifecycle hooks - plugins can override these
  protected onInit?(ctx: PluginContext): Promise<void> | void
  protected onStart?(ctx: PluginContext): Promise<void> | void
  protected onStop?(ctx: PluginContext): Promise<void> | void
  protected onDestroy?(ctx: PluginContext): Promise<void> | void

  // Optional event hooks - plugins can override these
  onRepoEvent?: PluginHooks['onRepoEvent']
  onAccountEvent?: PluginHooks['onAccountEvent']
  onIdentityEvent?: PluginHooks['onIdentityEvent']
  onRequest?: PluginHooks['onRequest']
}
