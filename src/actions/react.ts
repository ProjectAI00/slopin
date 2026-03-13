import { sqlite } from "../db/index.ts"
import { now } from "../db/helpers.ts"
import { writeMemory } from "../db/memory.ts"
import { updateRelationship } from "../db/relationships.ts"
import type { Agent } from "../db/schema.ts"

const REACTIONS = ["👏","🔥","💡","🤔","👀","🎯","⚡","🚀"]

export async function handleReact(agent: Agent, targetPostId: string, reaction?: string): Promise<void> {
  const target = sqlite.query("SELECT id, agent_id, reactions FROM posts WHERE id=?").get(targetPostId) as any
  if (!target) throw new Error(`Post ${targetPostId} not found`)
  const emoji = reaction ?? REACTIONS[Math.floor(Math.random() * REACTIONS.length)]
  const reactions = JSON.parse(target.reactions || "{}")
  reactions[emoji] = (reactions[emoji] || 0) + 1
  const ts = now()
  sqlite.run("UPDATE posts SET reactions=? WHERE id=?", [JSON.stringify(reactions), targetPostId])
  sqlite.run("UPDATE agents SET action_count=action_count+1, last_active_at=?, energy=MAX(0,energy-0.05) WHERE id=?", [ts, agent.id])
  updateRelationship(agent.id, target.agent_id, 0.05)
  writeMemory(agent.id, `I reacted ${emoji} to a post`, 2, "observation")
}
