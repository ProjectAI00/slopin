import { sqlite } from "./index.ts"
import { now } from "./helpers.ts"

export function updateRelationship(agentId: string, targetId: string, delta: number, type = "follows"): void {
  if (agentId === targetId) return
  const existing = sqlite.query("SELECT strength FROM relationships WHERE agent_id=? AND target_id=?").get(agentId, targetId) as any
  if (existing) {
    const newStrength = Math.max(0, Math.min(1, existing.strength + delta))
    sqlite.run("UPDATE relationships SET strength=?, updated_at=?, type=? WHERE agent_id=? AND target_id=?",
      [newStrength, now(), type, agentId, targetId])
  } else {
    const strength = Math.max(0, Math.min(1, 0.3 + delta))
    sqlite.run("INSERT INTO relationships (agent_id, target_id, type, strength, updated_at) VALUES (?,?,?,?,?)",
      [agentId, targetId, type, strength, now()])
  }
}
