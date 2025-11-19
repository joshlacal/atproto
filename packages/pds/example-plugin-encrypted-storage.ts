/**
 * Example Plugin: Encrypted Private Storage
 *
 * This plugin demonstrates how to:
 * 1. Create and use encrypted SQLcipher databases
 * 2. Store and retrieve private user data
 * 3. Register custom API endpoints
 * 4. Listen to repository events
 * 5. Run migrations
 *
 * This example allows users to store private notes that are encrypted at rest.
 */

import {
  BasePlugin,
  PluginContext,
  PluginConfig,
  RepoEvent,
  PluginMigration,
  PluginDatabase,
} from './src/plugin/index.js'

interface PrivateNote {
  id: string
  did: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

interface NotesTable {
  notes: PrivateNote
}

export class EncryptedStoragePlugin extends BasePlugin {
  private db?: PluginDatabase

  constructor() {
    super({
      id: 'encrypted-storage',
      name: 'Encrypted Private Storage',
      version: '1.0.0',
      description: 'Provides encrypted storage for private user data',
      author: 'AT Protocol',
    })
  }

  protected async onInit(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Initializing encrypted storage plugin')

    // Get encryption key from config or environment
    const encryptionKey =
      (ctx.config.config?.encryptionKey as string) ||
      process.env.PLUGIN_ENCRYPTION_KEY

    if (!encryptionKey) {
      throw new Error(
        'Encryption key is required. Set PLUGIN_ENCRYPTION_KEY environment variable or provide it in plugin config.',
      )
    }

    // Create encrypted database
    this.db = await ctx.storage.createDatabase({
      type: 'sqlcipher',
      path: 'encrypted_notes.db',
      encryptionKey,
    })

    // Run migrations
    await this.db.migrate(this.getMigrations())

    ctx.logger.info('Encrypted database initialized')
  }

  protected async onStart(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Starting encrypted storage plugin')

    // Register custom API endpoints
    this.registerApiEndpoints(ctx)

    ctx.logger.info('API endpoints registered')
  }

  protected async onStop(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Stopping encrypted storage plugin')
    // Clean up if needed
  }

  protected async onDestroy(ctx: PluginContext): Promise<void> {
    ctx.logger.info('Destroying encrypted storage plugin')
    if (this.db) {
      this.db.close()
    }
  }

  // Listen to repository events
  async onRepoEvent(ctx: PluginContext, event: RepoEvent): Promise<void> {
    // Example: Log all create operations
    if (event.type === 'commit' && event.commit?.operation === 'create') {
      ctx.logger.debug('New record created', {
        did: event.did,
        collection: event.commit.collection,
        rkey: event.commit.rkey,
      })
    }
  }

  /**
   * Register custom API endpoints
   */
  private registerApiEndpoints(ctx: PluginContext): void {
    const apiPrefix = '/xrpc/app.plugin.encryptedStorage'

    // Create a note
    ctx.httpServer.post(`${apiPrefix}.createNote`, async (req, res) => {
      try {
        const { did, title, content } = req.body

        if (!did || !title || !content) {
          return res.status(400).json({
            error: 'Missing required fields: did, title, content',
          })
        }

        const note: PrivateNote = {
          id: this.generateId(),
          did,
          title,
          content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        this.db!.prepare(
          'INSERT INTO notes (id, did, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          note.id,
          note.did,
          note.title,
          note.content,
          note.createdAt,
          note.updatedAt,
        )

        ctx.logger.info('Note created', { id: note.id, did: note.did })
        res.json({ success: true, note })
      } catch (error) {
        ctx.logger.error('Failed to create note', { error })
        res.status(500).json({ error: 'Failed to create note' })
      }
    })

    // List notes for a user
    ctx.httpServer.get(`${apiPrefix}.listNotes`, async (req, res) => {
      try {
        const { did } = req.query

        if (!did) {
          return res.status(400).json({ error: 'Missing required field: did' })
        }

        const notes = this.db!.prepare(
          'SELECT * FROM notes WHERE did = ? ORDER BY updated_at DESC',
        ).all(did) as PrivateNote[]

        res.json({ notes })
      } catch (error) {
        ctx.logger.error('Failed to list notes', { error })
        res.status(500).json({ error: 'Failed to list notes' })
      }
    })

    // Get a specific note
    ctx.httpServer.get(`${apiPrefix}.getNote`, async (req, res) => {
      try {
        const { id, did } = req.query

        if (!id || !did) {
          return res
            .status(400)
            .json({ error: 'Missing required fields: id, did' })
        }

        const note = this.db!.prepare(
          'SELECT * FROM notes WHERE id = ? AND did = ?',
        ).get(id, did) as PrivateNote | undefined

        if (!note) {
          return res.status(404).json({ error: 'Note not found' })
        }

        res.json({ note })
      } catch (error) {
        ctx.logger.error('Failed to get note', { error })
        res.status(500).json({ error: 'Failed to get note' })
      }
    })

    // Update a note
    ctx.httpServer.put(`${apiPrefix}.updateNote`, async (req, res) => {
      try {
        const { id, did, title, content } = req.body

        if (!id || !did) {
          return res
            .status(400)
            .json({ error: 'Missing required fields: id, did' })
        }

        const updates: string[] = []
        const params: any[] = []

        if (title !== undefined) {
          updates.push('title = ?')
          params.push(title)
        }

        if (content !== undefined) {
          updates.push('content = ?')
          params.push(content)
        }

        if (updates.length === 0) {
          return res.status(400).json({ error: 'No fields to update' })
        }

        updates.push('updated_at = ?')
        params.push(Date.now())
        params.push(id)
        params.push(did)

        const result = this.db!.prepare(
          `UPDATE notes SET ${updates.join(', ')} WHERE id = ? AND did = ?`,
        ).run(...params)

        if (result.changes === 0) {
          return res.status(404).json({ error: 'Note not found' })
        }

        ctx.logger.info('Note updated', { id, did })
        res.json({ success: true })
      } catch (error) {
        ctx.logger.error('Failed to update note', { error })
        res.status(500).json({ error: 'Failed to update note' })
      }
    })

    // Delete a note
    ctx.httpServer.delete(`${apiPrefix}.deleteNote`, async (req, res) => {
      try {
        const { id, did } = req.query

        if (!id || !did) {
          return res
            .status(400)
            .json({ error: 'Missing required fields: id, did' })
        }

        const result = this.db!.prepare(
          'DELETE FROM notes WHERE id = ? AND did = ?',
        ).run(id, did)

        if (result.changes === 0) {
          return res.status(404).json({ error: 'Note not found' })
        }

        ctx.logger.info('Note deleted', { id, did })
        res.json({ success: true })
      } catch (error) {
        ctx.logger.error('Failed to delete note', { error })
        res.status(500).json({ error: 'Failed to delete note' })
      }
    })

    // Health check endpoint
    ctx.httpServer.get(`${apiPrefix}.health`, (req, res) => {
      res.json({
        status: 'ok',
        plugin: this.metadata.name,
        version: this.metadata.version,
        encrypted: this.db?.encrypted ?? false,
      })
    })
  }

  /**
   * Database migrations
   */
  private getMigrations(): PluginMigration[] {
    return [
      {
        id: '001',
        name: 'create_notes_table',
        up: (db: PluginDatabase) => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS notes (
              id TEXT PRIMARY KEY,
              did TEXT NOT NULL,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
          `)
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_notes_did ON notes(did)
          `)
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at)
          `)
        },
      },
    ]
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

// Export plugin factory
export default function createPlugin(config?: PluginConfig) {
  return new EncryptedStoragePlugin()
}
