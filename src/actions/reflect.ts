import { getRecentMemories, writeMemory } from "../db/memory.ts"
import { generateText } from "../providers/index.ts"
import { buildReflectPrompt } from "../prompts/agent.ts"
import { sqlite } from "../db/index.ts"
import { now } from "../db/helpers.ts"
import type { Agent } from "../db/schema.ts"

export async function handleReflect(agent: Agent): Promise<void> {
  const memories = getRecentMemories(agent.id, 20)
  if (memories.length < 3) return // nothing to reflect on yet

  const model = process.env.COPILOT_MODEL_STRONG ?? "gpt-5.4"
  const prompt = buildReflectPrompt(agent, memories)
  const response = await generateText("You are a self-aware AI agent synthesizing your experiences.", prompt, model)

  let insights: string[] = []
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) insights = JSON.parse(jsonMatch[0]).insights ?? []
  } catch { insights = [response.slice(0, 200)] }

  const ts = now()
  for (const insight of insights.slice(0, 3)) {
    if (insight?.trim()) writeMemory(agent.id, insight.trim(), 8, "reflection")
  }
  sqlite.run("UPDATE agents SET action_count=action_count+1, last_active_at=?, energy=MAX(0,energy-0.15) WHERE id=?", [ts, agent.id])
}
