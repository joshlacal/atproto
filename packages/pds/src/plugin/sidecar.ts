import http from 'http'
import https from 'https'
import { EventEmitter } from 'events'
import type { SidecarConfig } from './types.js'

/**
 * Message types for sidecar communication
 */
export enum SidecarMessageType {
  Request = 'request',
  Response = 'response',
  Event = 'event',
  Heartbeat = 'heartbeat',
}

/**
 * Sidecar message
 */
export interface SidecarMessage {
  type: SidecarMessageType
  id?: string
  method?: string
  params?: unknown
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
  event?: string
  data?: unknown
}

/**
 * Sidecar client for communicating with sidecar plugins
 */
export class SidecarClient extends EventEmitter {
  private healthCheckInterval?: NodeJS.Timeout
  private connected = false

  constructor(
    private readonly pluginId: string,
    private readonly config: SidecarConfig,
  ) {
    super()
  }

  /**
   * Connect to the sidecar
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    // Verify connection based on method
    if (this.config.method === 'http') {
      await this.verifyHttpConnection()
    } else if (this.config.method === 'unix') {
      await this.verifyUnixConnection()
    } else if (this.config.method === 'grpc') {
      throw new Error('gRPC sidecars not yet implemented')
    }

    this.connected = true
    this.emit('connected')

    // Start health checks if enabled
    if (this.config.healthCheck?.enabled) {
      this.startHealthCheck()
    }
  }

  /**
   * Disconnect from the sidecar
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }

    this.connected = false
    this.emit('disconnected')
  }

  /**
   * Send a request to the sidecar
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
  ): Promise<T> {
    if (!this.connected) {
      throw new Error('Not connected to sidecar')
    }

    const message: SidecarMessage = {
      type: SidecarMessageType.Request,
      id: this.generateId(),
      method,
      params,
    }

    if (this.config.method === 'http') {
      return this.sendHttpRequest<T>(message)
    } else if (this.config.method === 'unix') {
      return this.sendUnixRequest<T>(message)
    } else {
      throw new Error(`Unsupported sidecar method: ${this.config.method}`)
    }
  }

  /**
   * Send an event to the sidecar
   */
  async sendEvent(event: string, data?: unknown): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to sidecar')
    }

    const message: SidecarMessage = {
      type: SidecarMessageType.Event,
      event,
      data,
    }

    if (this.config.method === 'http') {
      await this.sendHttpRequest(message)
    } else if (this.config.method === 'unix') {
      await this.sendUnixRequest(message)
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Verify HTTP connection
   */
  private async verifyHttpConnection(): Promise<void> {
    if (!this.config.connection.url) {
      throw new Error('HTTP sidecar URL not configured')
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.config.connection.url!)
      const client = url.protocol === 'https:' ? https : http

      const req = client.get(
        `${this.config.connection.url}/health`,
        { timeout: 5000 },
        (res) => {
          if (res.statusCode === 200) {
            resolve()
          } else {
            reject(
              new Error(`Health check failed with status ${res.statusCode}`),
            )
          }
        },
      )

      req.on('error', (error) => {
        reject(new Error(`Failed to connect to sidecar: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Connection timeout'))
      })
    })
  }

  /**
   * Verify Unix socket connection
   */
  private async verifyUnixConnection(): Promise<void> {
    if (!this.config.connection.socketPath) {
      throw new Error('Unix socket path not configured')
    }

    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          socketPath: this.config.connection.socketPath,
          path: '/health',
          timeout: 5000,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve()
          } else {
            reject(
              new Error(`Health check failed with status ${res.statusCode}`),
            )
          }
        },
      )

      req.on('error', (error) => {
        reject(new Error(`Failed to connect to sidecar: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Connection timeout'))
      })
    })
  }

  /**
   * Send HTTP request
   */
  private async sendHttpRequest<T>(message: SidecarMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.connection.url!)
      const client = url.protocol === 'https:' ? https : http

      const data = JSON.stringify(message)

      const req = client.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port,
          path: '/rpc',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: 30000,
        },
        (res) => {
          let body = ''
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            try {
              const response = JSON.parse(body) as SidecarMessage
              if (response.error) {
                reject(
                  new Error(
                    `Sidecar error: ${response.error.message}`,
                  ),
                )
              } else {
                resolve(response.result as T)
              }
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error}`))
            }
          })
        },
      )

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * Send Unix socket request
   */
  private async sendUnixRequest<T>(message: SidecarMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(message)

      const req = http.request(
        {
          socketPath: this.config.connection.socketPath,
          method: 'POST',
          path: '/rpc',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
          timeout: 30000,
        },
        (res) => {
          let body = ''
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            try {
              const response = JSON.parse(body) as SidecarMessage
              if (response.error) {
                reject(
                  new Error(
                    `Sidecar error: ${response.error.message}`,
                  ),
                )
              } else {
                resolve(response.result as T)
              }
            } catch (error) {
              reject(new Error(`Failed to parse response: ${error}`))
            }
          })
        },
      )

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * Start health check
   */
  private startHealthCheck(): void {
    const interval = this.config.healthCheck?.interval || 30000

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.request('health')
      } catch (error) {
        this.emit('health-check-failed', error)
        console.error(
          `[Plugin:${this.pluginId}] Health check failed:`,
          error,
        )
      }
    }, interval)
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Sidecar server base class for implementing sidecar plugins
 */
export class SidecarServer {
  protected server?: http.Server

  constructor(protected readonly pluginId: string) {}

  /**
   * Start the sidecar server
   */
  async start(config: SidecarConfig): Promise<void> {
    const app = this.createHandler()

    if (config.method === 'http') {
      this.server = http.createServer(app)
      const port = config.connection.port || 3001
      await new Promise<void>((resolve) => {
        this.server!.listen(port, () => {
          console.log(
            `[Sidecar:${this.pluginId}] Listening on port ${port}`,
          )
          resolve()
        })
      })
    } else if (config.method === 'unix') {
      this.server = http.createServer(app)
      const socketPath = config.connection.socketPath!
      await new Promise<void>((resolve) => {
        this.server!.listen(socketPath, () => {
          console.log(
            `[Sidecar:${this.pluginId}] Listening on ${socketPath}`,
          )
          resolve()
        })
      })
    }
  }

  /**
   * Stop the sidecar server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
      this.server = undefined
    }
  }

  /**
   * Create HTTP request handler
   */
  private createHandler(): (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void {
    return async (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200)
        res.end('OK')
        return
      }

      if (req.url === '/rpc' && req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', async () => {
          try {
            const message = JSON.parse(body) as SidecarMessage
            const response = await this.handleMessage(message)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          } catch (error) {
            const errorMessage = error instanceof Error
              ? error.message
              : 'Unknown error'
            const response: SidecarMessage = {
              type: SidecarMessageType.Response,
              error: {
                code: -1,
                message: errorMessage,
              },
            }
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          }
        })
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    }
  }

  /**
   * Handle incoming message - override in subclass
   */
  protected async handleMessage(
    message: SidecarMessage,
  ): Promise<SidecarMessage> {
    if (message.type === SidecarMessageType.Request) {
      const result = await this.handleRequest(
        message.method!,
        message.params,
      )
      return {
        type: SidecarMessageType.Response,
        id: message.id,
        result,
      }
    } else if (message.type === SidecarMessageType.Event) {
      await this.handleEvent(message.event!, message.data)
      return {
        type: SidecarMessageType.Response,
        id: message.id,
      }
    } else {
      throw new Error(`Unsupported message type: ${message.type}`)
    }
  }

  /**
   * Handle RPC request - override in subclass
   */
  protected async handleRequest(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    if (method === 'health') {
      return { status: 'ok' }
    }
    throw new Error(`Unknown method: ${method}`)
  }

  /**
   * Handle event - override in subclass
   */
  protected async handleEvent(event: string, data?: unknown): Promise<void> {
    // Override in subclass
  }
}
