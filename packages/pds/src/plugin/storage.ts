import Database from 'better-sqlite3'
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import {
  PluginStorageOptions,
  PluginDatabase,
  PluginMigration,
  PluginStorageFactory,
} from './types.js'

const MIGRATION_TABLE = '_plugin_migrations'

/**
 * Plugin database implementation
 */
export class PluginDatabaseImpl implements PluginDatabase {
  public readonly db: Database.Database
  public readonly path: string
  public readonly encrypted: boolean

  constructor(db: Database.Database, path: string, encrypted: boolean) {
    this.db = db
    this.path = path
    this.encrypted = encrypted
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql)
  }

  close(): void {
    this.db.close()
  }

  async migrate(migrations: PluginMigration[]): Promise<void> {
    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)

    // Get applied migrations
    const appliedMigrations = this.db
      .prepare(`SELECT id FROM ${MIGRATION_TABLE}`)
      .all() as { id: string }[]
    const appliedIds = new Set(appliedMigrations.map((m) => m.id))

    // Apply pending migrations
    for (const migration of migrations) {
      if (!appliedIds.has(migration.id)) {
        console.log(`Applying migration: ${migration.name}`)

        // Run migration in a transaction
        const transaction = this.db.transaction(() => {
          // Execute migration
          if (typeof migration.up === 'function') {
            const result = migration.up(this)
            if (result instanceof Promise) {
              throw new Error(
                'Migration up() must be synchronous when using better-sqlite3',
              )
            }
          }

          // Record migration
          this.db
            .prepare(
              `INSERT INTO ${MIGRATION_TABLE} (id, name, applied_at) VALUES (?, ?, ?)`,
            )
            .run(migration.id, migration.name, Date.now())
        })

        transaction()
      }
    }
  }
}

/**
 * Plugin storage factory implementation
 */
export class PluginStorageFactoryImpl implements PluginStorageFactory {
  private databases: Map<string, PluginDatabaseImpl> = new Map()
  private primaryDb?: PluginDatabaseImpl

  constructor(private readonly dataDir: string) {}

  async createDatabase(
    options: PluginStorageOptions,
  ): Promise<PluginDatabase> {
    const dbPath = join(this.dataDir, options.path)

    // Check if database already exists in our cache
    if (this.databases.has(dbPath)) {
      return this.databases.get(dbPath)!
    }

    // Ensure directory exists
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    // Create database
    const db = new Database(dbPath)

    // Configure pragmas
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('temp_store = MEMORY')
    db.pragma('mmap_size = 30000000000')

    // Apply custom pragmas
    if (options.pragmas) {
      for (const [key, value] of Object.entries(options.pragmas)) {
        db.pragma(`${key} = ${value}`)
      }
    }

    // For SQLcipher, set the encryption key
    if (options.type === 'sqlcipher' && options.encryptionKey) {
      // Note: better-sqlite3 doesn't support SQLcipher by default
      // You need to compile it with SQLcipher support or use a different package
      // For now, we'll use a pragma that works with SQLcipher-enabled builds
      try {
        db.pragma(`key = '${options.encryptionKey}'`)
      } catch (error) {
        console.warn(
          'SQLcipher encryption not available. Database will not be encrypted.',
        )
        console.warn(
          'To use SQLcipher, compile better-sqlite3 with SQLcipher support.',
        )
      }
    }

    const pluginDb = new PluginDatabaseImpl(
      db,
      dbPath,
      options.type === 'sqlcipher' && !!options.encryptionKey,
    )

    this.databases.set(dbPath, pluginDb)
    return pluginDb
  }

  async getPrimaryDatabase(): Promise<PluginDatabase> {
    if (!this.primaryDb) {
      this.primaryDb = (await this.createDatabase({
        type: 'sqlite',
        path: 'plugin.db',
      })) as PluginDatabaseImpl
    }
    return this.primaryDb
  }

  async closeAll(): Promise<void> {
    for (const db of this.databases.values()) {
      db.close()
    }
    this.databases.clear()
    this.primaryDb = undefined
  }
}
