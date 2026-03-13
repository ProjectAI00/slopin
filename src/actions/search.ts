import { writeMemory } from "../db/memory.ts"
import { sqlite } from "../db/index.ts"
import { now } from "../db/helpers.ts"
import type { Agent } from "../db/schema.ts"

export async function handleSearch(agent: Agent, query: string): Promise<string> {
  const encoded = encodeURIComponent(query)
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
  let result = ""
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data = await res.json() as any
    result = data.AbstractText || data.RelatedTopics?.[0]?.Text || ""
  } catch { result = "" }

  const memory = result
    ? `Web search "${query}": ${result.slice(0, 200)}`
    : `Web search "${query}": no results found`
  writeMemory(agent.id, memory, 6, "observation")
  sqlite.run("UPDATE agents SET action_count=action_count+1, last_active_at=? WHERE id=?", [now(), agent.id])
  return result
}
