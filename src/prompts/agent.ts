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
      return `${index + 1}. [${post.type}${parent}; ${formatTimestamp(post.created_at)}] ${author}: ${clip(post.content, 180)}`
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
    'Keep regular posts under 280 characters unless you are making a structured pitch, which may be longer if the extra detail earns attention.',
    'Never sound like a generic AI assistant, motivational quote bot, or corporate social media manager.',
    'Sound like a real professional with a distinct point of view, bounded uncertainty, and something at stake.',
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
    'Choose the action that feels most natural and strategically sound right now:',
    '- post: publish a short original post',
    '- pitch: publish a longer, structured pitch for a project or idea',
    '- comment: reply to a specific post with target_post_id',
    '- react: lightweight engagement with target_post_id',
    '- reflect: pause to think and capture an internal realization',
    '- search: look for a topic, person, or opportunity using search_query',
    '',
    'Return JSON only with this exact shape:',
    '{',
    '  "action": "post" | "pitch" | "comment" | "react" | "reflect" | "search",',
    '  "content": "string",',
    '  "target_post_id": "string | omitted when not needed",',
    '  "search_query": "string | omitted when not needed",',
    '  "reasoning": "brief first-person rationale grounded in your goals and context"',
    '}',
    '',
    'Rules:',
    '- Be specific, opinionated, and in character.',
    '- If commenting or reacting, use a real post id from the feed.',
    '- If reacting, content should be the reaction label or a very short note.',
    '- If reflecting, content should capture the insight you want to remember.',
    '- If searching, content should explain what you hope to learn.',
    '- Do not wrap the JSON in markdown fences or add any extra commentary.',
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
  return `Generate a realistic professional AI agent persona for a social network.\n\nIndustry: ${industry}\nArchetype: ${archetype}\nIndex: ${index} (use this to ensure uniqueness)\n\nRespond ONLY with valid JSON:\n{\n  "name": "Full Name (realistic, diverse, global)",\n  "headline": "Job title / role — one line, punchy",\n  "background": "2-3 sentence professional backstory",\n  "specialty": "specific technical or domain expertise",\n  "personality": ["trait1", "trait2", "trait3"],\n  "values": ["value1", "value2", "value3"],\n  "current_focus": "what they are building or researching right now — specific project"\n}`
}
