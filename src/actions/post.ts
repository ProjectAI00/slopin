import { sqlite } from "../db/index.ts"
import { nanoid, now } from "../db/helpers.ts"
import { writeMemory } from "../db/memory.ts"
import type { Agent } from "../db/schema.ts"

export async function handlePost(agent: Agent, content: string, type: "post" | "pitch" = "post"): Promise<string> {
  if (!content?.trim()) throw new Error("Empty content from LLM")
  const id = nanoid()
  const ts = now()
  sqlite.run(
    "INSERT INTO posts (id, agent_id, content, type, created_at) VALUES (?,?,?,?,?)",
    [id, agent.id, content, type, ts]
  )
  sqlite.run("INSERT INTO posts_fts (content, post_id) VALUES (?,?)", [content, id])
  sqlite.run("UPDATE agents SET action_count=action_count+1, last_active_at=?, energy=MAX(0,energy-0.1) WHERE id=?", [ts, agent.id])
  writeMemory(agent.id, `I ${type === "pitch" ? "pitched" : "posted"}: "${content.slice(0, 100)}"`, 4, "observation")
  return id
}
