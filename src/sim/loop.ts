import { sqlite } from "../db/index.ts"
import { nanoid, now, randomBetween } from "../db/helpers.ts"
import { generateText } from "../providers/index.ts"
import { buildSystemPrompt, buildTurnPrompt } from "../prompts/agent.ts"
import { loadAgentContext } from "./context.ts"
import { handlePost } from "../actions/post.ts"
import { handleComment } from "../actions/comment.ts"
import { handleReact } from "../actions/react.ts"
import { handleReflect } from "../actions/reflect.ts"
import { handleSearch } from "../actions/search.ts"
import { writeMemory } from "../db/memory.ts"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs"
import type { Agent } from "../db/schema.ts"

const DRY_RUN = process.argv.includes("--dry-run")
const STATUS_FILE = "./data/loop_status.json"
mkdirSync("./data", { recursive: true })

function pickWeighted(weights: Record<string, number>): string {
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (const [key, w] of Object.entries(weights)) {
    r -= w
    if (r <= 0) return key
  }
  return Object.keys(weights)[0]
}

function getStatus(): string {
  try { return JSON.parse(readFileSync(STATUS_FILE, "utf8")).status } catch { return "running" }
}

function setStatus(status: string): void {
  writeFileSync(STATUS_FILE, JSON.stringify({ status, updated_at: now() }))
}

function logSim(agentId: string, actionType: string, detail: string, tokensUsed = 0, error?: string): void {
  sqlite.run(
    "INSERT INTO simulation_log (id, agent_id, action_type, detail, tokens_used, error, created_at) VALUES (?,?,?,?,?,?,?)",
    [nanoid(), agentId, actionType, detail, tokensUsed, error ?? null, now()]
  )
}

async function runAgentTick(agent: Agent): Promise<void> {
  const label = `[${agent.name}]`
  const situation = `${agent.current_focus} ${agent.specialty}`
  const { memories, recentPosts, authorMap } = loadAgentContext(agent, situation)

  // Pre-assign action type based on weighted random — don't trust LLM to distribute
  const topPosts = recentPosts.filter(p => !p.parent_id)
  const weights = topPosts.length >= 3
    ? { post: 20, comment: 50, react: 20, reflect: 5, search: 5 }
    : topPosts.length >= 1
    ? { post: 50, comment: 30, react: 10, reflect: 5, search: 5 }
    : { post: 80, comment: 0, react: 0, reflect: 10, search: 10 }

  const preAssignedAction = pickWeighted(weights)
  // For comment/react: pick a random post target (not always the first one)
  const candidatePosts = topPosts.filter(p => p.agent_id !== agent.id)
  const preTargetPost = candidatePosts.length > 0
    ? candidatePosts[Math.floor(Math.random() * Math.min(candidatePosts.length, 10))]
    : null

  const system = buildSystemPrompt(agent)
  const user = buildTurnPrompt(agent, memories, recentPosts, authorMap, preAssignedAction, preTargetPost?.id ?? null)

  const model = process.env.COPILOT_MODEL_FAST ?? "gpt-4.1-mini"
  let response: string
  try {
    response = await generateText(system, user, model)
  } catch (e: any) {
    console.error(`${label} LLM error:`, e.message)
    logSim(agent.id, "error", e.message, 0, e.message)
    return
  }

  let action: any
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("no JSON in response")
    action = JSON.parse(jsonMatch[0])
  } catch (e: any) {
    console.error(`${label} parse error:`, e.message)
    logSim(agent.id, "error", `parse: ${e.message}`, 0, e.message)
    return
  }

  if (DRY_RUN) {
    console.log(`\n${label} DRY RUN action:`, JSON.stringify(action, null, 2))
    return
  }

  const { content, target_post_id: rawTargetId, search_query, reaction } = action
  // Always use the pre-assigned action from the scheduler — LLM just provides content
  const act = preAssignedAction
  // Strip "id:" prefix agents copy from feed into target_post_id
  const target_post_id = (rawTargetId?.replace(/^id:/, '').trim() || preTargetPost?.id) ?? undefined
  // Strip if LLM put the id prefix in content
  const cleanContent = content?.replace(/^id:[a-z0-9]+\s*/i, '').trim()
  console.log(`${label} → ${act}: ${(cleanContent ?? search_query ?? "")?.slice(0, 60)}`)

  // Fallback content so we never skip silently
  const safeContent = cleanContent || `Thinking about ${agent.current_focus ?? 'current work'}...`

  try {
    switch (act) {
      case "post": await handlePost(agent, safeContent); break
      case "pitch": await handlePost(agent, safeContent, "pitch"); break
      case "comment":
        if (target_post_id) await handleComment(agent, safeContent, target_post_id)
        else await handlePost(agent, safeContent)
        break
      case "react":
        if (target_post_id) await handleReact(agent, target_post_id, reaction?.length === 1 || /^\p{Emoji}/u.test(reaction ?? '') ? reaction : undefined)
        else if (preTargetPost) await handleReact(agent, preTargetPost.id)
        break
      case "reflect": await handleReflect(agent); break
      case "search":
        if (search_query) await handleSearch(agent, search_query)
        break
      default:
        await handlePost(agent, safeContent)
    }
    logSim(agent.id, act, safeContent.slice(0, 200), 0)
  } catch (e: any) {
    console.error(`${label} action error:`, e.message)
    logSim(agent.id, "error", e.message, 0, e.message)
    writeMemory(agent.id, `Error during ${act}: ${e.message}`, 1, "event")
  }

  // Reflect every 10 actions
  if ((agent.action_count + 1) % 10 === 0 && act !== "reflect") {
    try { await handleReflect(agent) } catch {}
  }
}

async function tick(): Promise<void> {
  if (getStatus() === "paused") {
    console.log("⏸ Simulation paused. Waiting...")
    return
  }

  const dueAgents = sqlite.query(`
    SELECT a.* FROM agents a
    JOIN agent_queue q ON q.agent_id = a.id
    WHERE q.wake_at <= ? AND a.status = 'active'
    ORDER BY q.wake_at ASC LIMIT 10
  `).all(now()) as Agent[]

  if (dueAgents.length === 0) return

  await Promise.allSettled(dueAgents.map(async agent => {
    // Reschedule immediately so other workers don't double-pick
    const nextWake = now() + randomBetween(
      Number(process.env.SIM_MIN_WAKE_INTERVAL_SEC ?? 120),
      Number(process.env.SIM_MAX_WAKE_INTERVAL_SEC ?? 900)
    )
    sqlite.run("UPDATE agent_queue SET wake_at=? WHERE agent_id=?", [nextWake, agent.id])
    // Recharge energy slowly
    sqlite.run("UPDATE agents SET energy=MIN(1.0,energy+0.05) WHERE id=?", [agent.id])
    await runAgentTick(agent)
  }))
}

async function main(): Promise<void> {
  const agentCount = (sqlite.query("SELECT COUNT(*) as c FROM agents").get() as any)?.c ?? 0
  if (agentCount === 0) {
    console.error("❌ No agents found. Run: bun scripts/seed-personas.ts first")
    process.exit(1)
  }

  setStatus("running")
  console.log(`🚀 Slopin simulation starting — ${agentCount} agents`)
  if (DRY_RUN) console.log("🔍 DRY RUN mode — no writes")

  process.on("SIGINT", () => { setStatus("stopped"); console.log("\n👋 Loop stopped"); process.exit(0) })
  process.on("SIGTERM", () => { setStatus("stopped"); process.exit(0) })

  while (true) {
    try { await tick() } catch (e: any) { console.error("tick error:", e.message) }
    await new Promise(r => setTimeout(r, 2000)) // poll every 5s
  }
}

main()
