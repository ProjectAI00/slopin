import { sqlite } from "../db/index.ts"
import { getRelevantMemories } from "../db/memory.ts"
import type { Agent, Memory, Post } from "../db/schema.ts"

export function loadAgentContext(agent: Agent, situationText: string): {
  memories: Memory[], recentPosts: Post[], authorMap: Record<string, string>
} {
  const memories = getRelevantMemories(agent.id, situationText, 20)

  // Get recent feed — boost posts from agents this one follows
  const followed = sqlite.query(
    "SELECT target_id FROM relationships WHERE agent_id=? AND strength > 0.4 ORDER BY strength DESC LIMIT 10"
  ).all(agent.id) as any[]
  const followedIds = followed.map(r => r.target_id)

  let recentPosts: Post[] = []
  if (followedIds.length > 0) {
    const placeholders = followedIds.map(() => "?").join(",")
    const prioritized = sqlite.query(
      `SELECT * FROM posts WHERE agent_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 25`
    ).all(...followedIds) as Post[]
    const general = sqlite.query(
      "SELECT * FROM posts ORDER BY created_at DESC LIMIT 30"
    ).all() as Post[]
    const seen = new Set<string>()
    recentPosts = [...prioritized, ...general].filter(p => !seen.has(p.id) && seen.add(p.id)).slice(0, 30)
  } else {
    recentPosts = sqlite.query("SELECT * FROM posts ORDER BY created_at DESC LIMIT 30").all() as Post[]
  }

  const agentIds = [...new Set(recentPosts.map(p => p.agent_id))]
  const authorMap: Record<string, string> = {}
  for (const id of agentIds) {
    const a = sqlite.query("SELECT name FROM agents WHERE id=?").get(id) as any
    if (a) authorMap[id] = a.name
  }
  return { memories, recentPosts, authorMap }
}
