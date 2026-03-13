import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { mkdirSync } from "fs"
import * as schema from "./schema.ts"

const DB_PATH = process.env.DB_PATH ?? "./data/slopin.db"
mkdirSync(DB_PATH.replace(/\/[^/]+$/, ""), { recursive: true })

export const sqlite = new Database(DB_PATH)
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")

// Bootstrap all tables (idempotent — uses IF NOT EXISTS)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    headline TEXT NOT NULL,
    background TEXT NOT NULL,
    specialty TEXT NOT NULL,
    personality TEXT NOT NULL DEFAULT '[]',
    "values" TEXT NOT NULL DEFAULT '[]',
    current_focus TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    energy REAL NOT NULL DEFAULT 1.0,
    action_count INTEGER NOT NULL DEFAULT 0,
    last_active_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 5,
    type TEXT NOT NULL DEFAULT 'observation',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'post',
    parent_id TEXT,
    reactions TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS relationships (
    agent_id TEXT NOT NULL REFERENCES agents(id),
    target_id TEXT NOT NULL REFERENCES agents(id),
    type TEXT NOT NULL DEFAULT 'follows',
    strength REAL NOT NULL DEFAULT 0.5,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, target_id)
  );
  CREATE TABLE IF NOT EXISTS agent_queue (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id),
    wake_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS simulation_log (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    detail TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(content, post_id UNINDEXED);
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, memory_id UNINDEXED);
`)

export const db = drizzle(sqlite, { schema })
export default db
