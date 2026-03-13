import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import * as schema from "./schema"

type StatementCompat = {
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
  run: (...params: unknown[]) => unknown
}

type RawDbCompat = {
  exec: (sql: string) => unknown
  loadExtension: (file: string, entrypoint?: string) => void
  prepare?: (sql: string) => StatementCompat
  pragma?: (value: string) => unknown
  query?: (sql: string) => StatementCompat
}

const isBunRuntime = typeof Bun !== "undefined"
export const databasePath = resolve(process.cwd(), process.env.DB_PATH ?? "./data/slopin.db")
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle")

mkdirSync(dirname(databasePath), { recursive: true })

const sqliteVec = await import("sqlite-vec")

const runtime = await (async () => {
  if (isBunRuntime) {
    const { Database } = await import("bun:sqlite")
    const { drizzle } = await import("drizzle-orm/bun-sqlite")
    const { migrate } = await import("drizzle-orm/bun-sqlite/migrator")

    const rawDb = new Database(databasePath, { create: true })
    rawDb.exec("PRAGMA foreign_keys = ON;")
    rawDb.exec("PRAGMA journal_mode = WAL;")

    let vectorEnabled = true
    try {
      sqliteVec.load(rawDb)
    } catch {
      vectorEnabled = false
    }

    const db = drizzle(rawDb, { schema })
    migrate(db, { migrationsFolder })

    return { rawDb, db, vectorEnabled }
  }

  const [{ default: Database }, { drizzle }, { migrate }] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
    import("drizzle-orm/better-sqlite3/migrator"),
  ])

  const rawDb = new Database(databasePath)
  rawDb.pragma("foreign_keys = ON")
  rawDb.pragma("journal_mode = WAL")
  sqliteVec.load(rawDb)

  const db = drizzle(rawDb, { schema })
  migrate(db, { migrationsFolder })

  return { rawDb, db, vectorEnabled: true }
})()

const rawDb: RawDbCompat = runtime.rawDb
const vectorEnabled = runtime.vectorEnabled

export const db = runtime.db

const prepareStatement = (sql: string): StatementCompat => {
  if (typeof rawDb.prepare === "function") {
    return rawDb.prepare(sql)
  }

  if (typeof rawDb.query === "function") {
    return rawDb.query(sql)
  }

  throw new Error("SQLite driver does not support prepared statements")
}

const hasTable = (name: string) =>
  Boolean(prepareStatement("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))

rawDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(content, post_id UNINDEXED);`)
rawDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, memory_id UNINDEXED);`)

if (vectorEnabled) {
  rawDb.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(memory_id TEXT, embedding float[768]);`)
}

if (hasTable("posts")) {
  rawDb.exec(`
    CREATE TRIGGER IF NOT EXISTS posts_fts_after_insert
    AFTER INSERT ON posts
    BEGIN
      INSERT INTO posts_fts(content, post_id) VALUES (new.content, new.id);
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_after_delete
    AFTER DELETE ON posts
    BEGIN
      DELETE FROM posts_fts WHERE post_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_after_update
    AFTER UPDATE OF content ON posts
    BEGIN
      DELETE FROM posts_fts WHERE post_id = old.id;
      INSERT INTO posts_fts(content, post_id) VALUES (new.content, new.id);
    END;

    DELETE FROM posts_fts;
    INSERT INTO posts_fts(content, post_id)
    SELECT content, id FROM posts;
  `)
}

if (hasTable("memories")) {
  rawDb.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_after_insert
    AFTER INSERT ON memories
    BEGIN
      INSERT INTO memories_fts(content, memory_id) VALUES (new.content, new.id);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_after_delete
    AFTER DELETE ON memories
    BEGIN
      DELETE FROM memories_fts WHERE memory_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_after_update
    AFTER UPDATE OF content ON memories
    BEGIN
      DELETE FROM memories_fts WHERE memory_id = old.id;
      INSERT INTO memories_fts(content, memory_id) VALUES (new.content, new.id);
    END;

    DELETE FROM memories_fts;
    INSERT INTO memories_fts(content, memory_id)
    SELECT content, id FROM memories;
  `)
}

export const sqlite = {
  raw: rawDb,
  exec: rawDb.exec.bind(rawDb),
  loadExtension: rawDb.loadExtension.bind(rawDb),
  prepare: prepareStatement,
  run(sql: string, params: unknown[] = []) {
    return prepareStatement(sql).run(...params)
  },
  query(sql: string) {
    const statement = prepareStatement(sql)
    return {
      get: (...params: unknown[]) => statement.get(...params),
      all: (...params: unknown[]) => statement.all(...params),
      run: (...params: unknown[]) => statement.run(...params),
    }
  },
}

export { rawDb, schema }
export default db
