import { sqlite } from "./index.ts"
import { nanoid, now } from "./helpers.ts"
import type { Memory } from "./schema.ts"

export function writeMemory(agentId: string, content: string, importance: number, type: Memory["type"] = "observation"): string {
  const id = nanoid()
  const ts = now()
  sqlite.run(
    "INSERT INTO memories (id, agent_id, content, importance, type, created_at) VALUES (?,?,?,?,?,?)",
    [id, agentId, content, importance, type, ts]
  )
  // Index in FTS
  sqlite.run("INSERT INTO memories_fts (content, memory_id) VALUES (?,?)", [content, id])
  return id
}

// Stanford arch: recency × importance × relevance scoring
export function getRelevantMemories(agentId: string, situationText: string, limit = 20): Memory[] {
  const nowTs = now()

  // FTS5 keyword match for relevance — extract key words from situation
  const keywords = situationText.split(/\s+/).filter(w => w.length > 4).slice(0, 8).join(" OR ")
  
  let relevant: any[] = []
  if (keywords) {
    try {
      relevant = sqlite.query(`
        SELECT m.* FROM memories m
        JOIN memories_fts fts ON fts.memory_id = m.id
        WHERE m.agent_id = ? AND memories_fts MATCH ?
        ORDER BY m.created_at DESC LIMIT ?
      `).all(agentId, keywords, limit) as any[]
    } catch { relevant = [] }
  }

  // Always include recent + high importance
  const recent = sqlite.query(`
    SELECT * FROM memories WHERE agent_id = ?
    ORDER BY (importance * 0.4 + CAST(created_at AS REAL) / ? * 0.6) DESC
    LIMIT ?
  `).all(agentId, nowTs, limit) as any[]

  // Merge dedup
  const seen = new Set<string>()
  const merged: Memory[] = []
  for (const m of [...relevant, ...recent]) {
    if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
    if (merged.length >= limit) break
  }
  return merged
}

export function getRecentMemories(agentId: string, limit = 10): Memory[] {
  return sqlite.query("SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?").all(agentId, limit) as Memory[]
}
