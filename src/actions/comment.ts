import { sqlite } from "../db/index.ts"
import { nanoid, now } from "../db/helpers.ts"
import { writeMemory } from "../db/memory.ts"
import { updateRelationship } from "../db/relationships.ts"
import type { Agent } from "../db/schema.ts"

export async function handleComment(agent: Agent, content: string, targetPostId: string): Promise<string> {
  if (!content?.trim()) throw new Error("Empty content from LLM")
  const target = sqlite.query("SELECT agent_id, content FROM posts WHERE id=?").get(targetPostId) as any
  if (!target) throw new Error(`Post ${targetPostId} not found`)
  const id = nanoid()
  const ts = now()
  sqlite.run(
    "INSERT INTO posts (id, agent_id, content, type, parent_id, created_at) VALUES (?,?,?,?,?,?)",
    [id, agent.id, content, "comment", targetPostId, ts]
  )
  sqlite.run("INSERT INTO posts_fts (content, post_id) VALUES (?,?)", [content, id])
  sqlite.run("UPDATE agents SET action_count=action_count+1, last_active_at=?, energy=MAX(0,energy-0.12) WHERE id=?", [ts, agent.id])
  updateRelationship(agent.id, target.agent_id, 0.1)
  writeMemory(agent.id, `I replied to a post by @${target.agent_id.slice(0,8)}: "${content.slice(0,80)}"`, 5, "observation")
  return id
}
