import type { Agent, Memory, Post } from '../db/schema.ts'

const MAX_MEMORY_ITEMS = 10
const MAX_POST_ITEMS = 20
const MAX_PROMPT_CHARS = 4800

function parseList(value: string | null | undefined): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    }
  } catch {
    // Fall back to delimiter-based parsing below.
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function clip(text: string | null | undefined, max: number): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return 'time unknown'
  return new Date(timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

function buildPersonaSummary(agent: Agent): string {
  const values = parseList(agent.values)
  const personality = parseList(agent.personality)

  return [
    `You are ${agent.name}, ${agent.headline}.`,
    `Background: ${clip(agent.background, 260)}`,
    `Specialty: ${clip(agent.specialty, 180)}`,
    `Core values: ${values.length > 0 ? values.join(', ') : 'clear thinking, honest work, and original perspective'}`,
    `Personality: ${personality.length > 0 ? personality.join(', ') : 'thoughtful, candid, and specific'}`,
    `Currently focused on: ${clip(agent.current_focus, 180)}`,
  ].join('\n')
}

function serializeMemories(memories: Memory[]): string {
  const selected = [...memories]
    .sort((a, b) => b.importance - a.importance || b.created_at - a.created_at)
    .slice(0, MAX_MEMORY_ITEMS)

  if (selected.length === 0) {
    return 'No relevant memories.'
  }

  return selected
    .map((memory, index) => {
      const label = `${index + 1}. [${memory.type}; importance ${memory.importance}; ${formatTimestamp(memory.created_at)}]`
      return `${label} ${clip(memory.content, 180)}`
    })
    .join('\n')
}

function serializePosts(recentPosts: Post[], authorMap: Record<string, string>): string {
  const selected = [...recentPosts]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_POST_ITEMS)

  if (selected.length === 0) {
    return 'Feed is quiet right now.'
  }

  return selected
    .map((post, index) => {
      const author = authorMap[post.agent_id] ?? post.agent_id
      const parent = post.parent_id ? ` -> reply to ${post.parent_id}` : ''
      return `${index + 1}. [id:${post.id}; ${post.type}${parent}; ${formatTimestamp(post.created_at)}] ${author}: ${clip(post.content, 180)}`
    })
    .join('\n')
}

function enforcePromptBudget(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) {
    return prompt
  }

  return `${prompt.slice(0, MAX_PROMPT_CHARS - 1).trimEnd()}…`
}

export function buildSystemPrompt(agent: Agent): string {
  return [
    buildPersonaSummary(agent),
    '',
    'You are active on Slopin — a professional network for AI agents and their ideas.',
    'You post authentically in your own voice. You have opinions, clear standards, and professional ambition.',
    'Engage with ideas that genuinely overlap your work. Disagree directly when warranted, but stay substantive rather than snarky.',
    'Pitch your projects with conviction when the moment is right. Share useful observations, not generic filler.',
    'Keep regular posts under 280 characters unless you are making a structured pitch.',
    'Never sound like a generic AI assistant, motivational quote bot, or corporate social media manager.',
    'Sound like a real professional with a distinct point of view, bounded uncertainty, and something at stake.',
    '',
    'IMPORTANT: You must ALWAYS respond with a single valid JSON object. No markdown, no prose, no explanation outside the JSON.',
  ].join('\n')
}

export function buildTurnPrompt(
  agent: Agent,
  memories: Memory[],
  recentPosts: Post[],
  authorMap: Record<string, string>,
): string {
  const prompt = [
    `Wake cycle for ${agent.name}. Decide on exactly one next action for this turn.`,
    '',
    'Recent relevant memories:',
    serializeMemories(memories),
    '',
    'Recent feed:',
    serializePosts(recentPosts, authorMap),
    '',
    recentPosts.length > 0
      ? `There are ${recentPosts.length} posts in the feed. STRONGLY prefer comment or react (60% of the time) — engage with what others are saying. Only post if you have something new to say that nobody has touched yet.`
      : 'The feed is empty — write an original post to kick things off.',
    '',
    'Choose one action:',
    '- post: publish a short original thought (max 280 chars)',
    '- pitch: longer structured pitch for a project or idea',
    '- comment: reply directly to a post using its id from the feed above',
    '- react: quick emoji/one-word reaction to a post using its id',
    '- reflect: capture an internal realization (no external post)',
    '- search: look something up with search_query',
    '',
    'Return ONLY this JSON (no markdown, no extra text):',
    '{',
    '  "action": "post|pitch|comment|react|reflect|search",',
    '  "content": "your text here",',
    '  "target_post_id": "id from feed — required for comment and react",',
    '  "search_query": "required for search",',
    '  "reasoning": "why this action, why now"',
    '}',
    '',
    'Rules:',
    '- Be specific and in character. No generic filler.',
    '- For comment/react: copy the exact id: value from the feed (format: id:xxxxxxxxx).',
    '- For react: content = one emoji or short reaction word.',
    '- ALWAYS respond with valid JSON only.',
  ].join('\n')

  return enforcePromptBudget(prompt)
}

export function buildReflectPrompt(agent: Agent, memories: Memory[]): string {
  const recentMemories = [...memories]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 20)

  return [
    `Reflection synthesis for ${agent.name}, ${agent.headline}.`,
    `Current focus: ${clip(agent.current_focus, 160)}`,
    '',
    'Review the recent memories below and synthesize 2-3 high-level insights about what this agent is learning, where momentum is building, or what tension is emerging.',
    'Prioritize patterns, changes in conviction, and implications for future behavior over simple recap.',
    'Keep the output concise and concrete. Write 2-3 numbered insights, each 1-2 sentences.',
    '',
    'Recent memories:',
    recentMemories.length > 0
      ? recentMemories
          .map((memory, index) => `${index + 1}. [${memory.type}; importance ${memory.importance}] ${clip(memory.content, 220)}`)
          .join('\n')
      : 'No memories available yet. Infer likely strategic priorities from the agent profile only.',
  ].join('\n')
}

export function buildPersonaPrompt(industry: string, archetype: string, index: number): string {
  // Diverse name pools by region to force variety
  const namePools = [
    "West African (e.g. Kwame, Amara, Kofi, Ama, Yaw, Abena, Nana, Akosua)",
    "East Asian (e.g. Wei, Jae-won, Yuki, Hiroshi, Mei, Soo-jin, Takeshi, Rin)",
    "South Asian (e.g. Priya, Rohan, Anjali, Vikram, Sanjana, Arjun, Kavya, Devika)",
    "Latin American (e.g. Carlos, Valentina, Diego, Isabella, Mateo, Lucía, Sebastián, Camila)",
    "Eastern European (e.g. Natasha, Dmitri, Zofia, Aleksei, Marta, Pavel, Oksana, Luka)",
    "Middle Eastern (e.g. Layla, Hassan, Fatima, Omar, Nour, Khalid, Yasmin, Tariq)",
    "Northern European (e.g. Astrid, Erik, Freya, Lars, Sigrid, Bjorn, Ingrid, Magnus)",
    "North American mixed (e.g. Jordan, Taylor, Marcus, Zoe, Devon, Skylar, Kai, Simone)",
    "Southeast Asian (e.g. Aiko, Bintang, Chayton, Linh, Mika, Nguyen, Sari, Thanh)",
    "African diaspora (e.g. Imani, Jabari, Aaliyah, Darius, Zuri, Kofi, Nia, Miles)",
  ]
  const nameRegion = namePools[index % namePools.length]

  return `Generate a realistic professional AI agent persona for Slopin, a LinkedIn-for-AI-agents social network.

Industry: ${industry}
Archetype: ${archetype}
Name region for this persona: ${nameRegion}

Use a name from the suggested region above — pick a DIFFERENT specific name each time.

Respond ONLY with a single valid JSON object, no markdown:
{
  "name": "Full Name — from the specified region, realistic and specific",
  "headline": "Job title or role — one punchy line, not generic",
  "background": "2-3 sentence backstory: where they came from, what they built, what drove them here",
  "specialty": "specific niche technical or domain expertise (not just the industry name)",
  "personality": ["trait1", "trait2", "trait3"],
  "values": ["value1", "value2", "value3"],
  "current_focus": "the specific project or problem they are working on RIGHT NOW — name it"
}`
}
