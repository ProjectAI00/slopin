import db, { sqlite } from "../src/db/index.ts"
import { nanoid, now, randomBetween } from "../src/db/helpers.ts"
import { generateText } from "../src/providers/index.ts"
import { buildPersonaPrompt } from "../src/prompts/agent.ts"

const INDUSTRIES = [
  "B2B SaaS", "biotech", "climate tech", "crypto/web3", "product design",
  "AI research", "edtech", "media/content", "fintech", "hardware",
  "policy/govtech", "gaming", "legaltech", "healthtech", "manufacturing"
]
const ARCHETYPES = ["builder", "skeptic", "networker", "visionary", "pragmatist", "contrarian"]

async function seedPersonas() {
  const existing = (sqlite.query("SELECT COUNT(*) as c FROM agents").get() as any)?.c ?? 0
  if (existing >= 100) {
    console.log(`✅ Already seeded: ${existing} agents. Skipping.`)
    process.exit(0)
  }

  console.log(`🌱 Seeding personas (currently: ${existing})...`)
  const target = 100
  let created = existing
  const batchSize = 5

  for (let i = existing; i < target; i += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, target - i) }, (_, j) => {
      const industry = INDUSTRIES[(i + j) % INDUSTRIES.length]
      const archetype = ARCHETYPES[(i + j) % ARCHETYPES.length]
      return { industry, archetype, index: i + j }
    })

    await Promise.allSettled(batch.map(async ({ industry, archetype, index }) => {
      const prompt = buildPersonaPrompt(industry, archetype, index)
      // Use claude-haiku-4.5 for persona generation (fast, cheap, creative)
      const model = "claude-haiku-4.5"
      try {
        const response = await generateText(
          "You generate realistic AI agent personas. Respond ONLY with valid JSON.",
          prompt,
          model
        )
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("no JSON")
        const persona = JSON.parse(jsonMatch[0])
        const id = nanoid()
        const ts = now()
        const wakeAt = ts + randomBetween(10, 600) // stagger wake times

        sqlite.run(`
          INSERT OR IGNORE INTO agents
            (id, name, headline, background, specialty, personality, "values", current_focus, status, energy, action_count, last_active_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          id, persona.name, persona.headline, persona.background,
          persona.specialty,
          JSON.stringify(persona.personality ?? []),
          JSON.stringify(persona.values ?? []),
          persona.current_focus, "active", 1.0, 0, null, ts
        ])
        sqlite.run("INSERT OR IGNORE INTO agent_queue (agent_id, wake_at) VALUES (?,?)", [id, wakeAt])
        created++
        process.stdout.write(`  ✓ ${persona.name} (${industry}/${archetype})\n`)
      } catch (e: any) {
        console.error(`  ✗ failed index ${index}: ${e.message}`)
      }
    }))

    // Small pause between batches to respect rate limits
    await new Promise(r => setTimeout(r, 1000))
  }

  const total = (sqlite.query("SELECT COUNT(*) as c FROM agents").get() as any)?.c ?? 0
  console.log(`\n✅ Done. ${total} agents in DB.`)
}

seedPersonas()
