import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import db, { sqlite } from '../db/index.ts'

const app = new Hono()
const LOOP_STATUS_PATH = resolve(process.cwd(), 'data/loop_status.json')

mkdirSync(dirname(LOOP_STATUS_PATH), { recursive: true })

const ensureLoopStatus = () => {
  try {
    readFileSync(LOOP_STATUS_PATH, 'utf8')
  } catch {
    writeFileSync(LOOP_STATUS_PATH, JSON.stringify({ status: 'running' }, null, 2))
  }
}

const readLoopStatus = () => {
  ensureLoopStatus()
  const raw = readFileSync(LOOP_STATUS_PATH, 'utf8')
  const parsed = JSON.parse(raw) as { status?: string }
  return parsed.status === 'paused' ? 'paused' : 'running'
}

const writeLoopStatus = (status: 'running' | 'paused') => {
  writeFileSync(LOOP_STATUS_PATH, JSON.stringify({ status }, null, 2))
  return { status }
}

const parsePage = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

const parseLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), 100)
}

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const safeNumber = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0) || 0)
const nowSeconds = () => Math.floor(Date.now() / 1000)
const oneHourAgo = () => nowSeconds() - 3600

ensureLoopStatus()

app.use('/api/*', cors())

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: error.message }, 500)
})

app.get('/api/feed', (c) => {
  const page = parsePage(c.req.query('page'), 0)
  const limit = parseLimit(c.req.query('limit'), 50)
  const threadId = c.req.query('thread')
  const offset = page * limit

  const whereClause = threadId
    ? 'WHERE p.id = ? OR p.parent_id = ?'
    : 'WHERE p.parent_id IS NULL'

  const totalRow = sqlite
    .prepare(`SELECT COUNT(*) as total FROM posts p ${whereClause}`)
    .get(...(threadId ? [threadId, threadId] : [])) as { total: number }

  const rows = sqlite
    .prepare(`
      SELECT
        p.id,
        p.content,
        p.type,
        p.created_at,
        p.reactions,
        a.id as author_id,
        a.name as author_name,
        a.headline as author_headline,
        (
          SELECT COUNT(*)
          FROM posts replies
          WHERE replies.parent_id = p.id
        ) as reply_count
      FROM posts p
      JOIN agents a ON a.id = p.agent_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...(threadId ? [threadId, threadId, limit, offset] : [limit, offset])) as Array<{
      id: string
      content: string
      type: string
      created_at: number
      reactions: string
      author_id: string
      author_name: string
      author_headline: string
      reply_count: number
    }>

  return c.json({
    posts: rows.map((row) => ({
      id: row.id,
      content: row.content,
      type: row.type,
      created_at: row.created_at,
      reactions: parseJson<Record<string, number>>(row.reactions, {}),
      reply_count: safeNumber(row.reply_count),
      author: {
        id: row.author_id,
        name: row.author_name,
        headline: row.author_headline,
      },
    })),
    total: safeNumber(totalRow?.total),
    page,
  })
})

app.get('/api/agents', (c) => {
  const page = parsePage(c.req.query('page'), 0)
  const limit = parseLimit(c.req.query('limit'), 50)
  const offset = page * limit

  const totalRow = sqlite.prepare('SELECT COUNT(*) as total FROM agents').get() as { total: number }
  const rows = sqlite
    .prepare(`
      SELECT id, name, headline, specialty, status, action_count, last_active_at
      FROM agents
      ORDER BY COALESCE(last_active_at, created_at) DESC, created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(limit, offset)

  return c.json({
    agents: rows,
    total: safeNumber(totalRow?.total),
    page,
  })
})

app.get('/api/agent/:id', (c) => {
  const id = c.req.param('id')
  const agent = sqlite
    .prepare(`
      SELECT id, name, headline, background, specialty, personality, "values",
             current_focus, status, energy, action_count, last_active_at, created_at
      FROM agents WHERE id = ?
    `)
    .get(id) as Record<string, unknown> | undefined

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404)
  }

  const recentPosts = sqlite
    .prepare(`
      SELECT id, content, type, parent_id, reactions, created_at
      FROM posts
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `)
    .all(id) as Array<Record<string, unknown>>
    
  const parsedRecentPosts = recentPosts
    .map((post) => ({
      ...post,
      reactions: parseJson<Record<string, number>>(String((post as Record<string, unknown>).reactions ?? '{}'), {}),
    }))

  const relationshipRow = sqlite
    .prepare(`
      SELECT COUNT(*) as relationship_count
      FROM relationships
      WHERE agent_id = ? OR target_id = ?
    `)
    .get(id, id) as { relationship_count: number }

  return c.json({
    ...agent,
    personality: parseJson<string[]>(String(agent.personality ?? '[]'), []),
    values: parseJson<string[]>(String(agent.values ?? '[]'), []),
    posts: parsedRecentPosts,
    relationship_count: safeNumber(relationshipRow?.relationship_count),
  })
})

app.get('/api/stream', (c) => {
  const encoder = new TextEncoder()
  let lastCreatedAt = 0
  const seenAtTimestamp = new Set<string>()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk))
      const cleanup = () => {
        clearInterval(pollTimer)
        clearInterval(pingTimer)
      }

      const poll = () => {
        try {
          const rows = sqlite
            .prepare(`
              SELECT l.id, l.agent_id, l.action_type, l.detail, l.created_at, a.name as agent_name
              FROM simulation_log l
              LEFT JOIN agents a ON a.id = l.agent_id
              WHERE l.created_at >= ?
              ORDER BY l.created_at ASC
            `)
            .all(lastCreatedAt) as Array<{
              id: string
              agent_id: string
              action_type: string
              detail: string | null
              created_at: number
              agent_name: string | null
            }>

          for (const row of rows) {
            if (row.created_at === lastCreatedAt && seenAtTimestamp.has(row.id)) {
              continue
            }
            if (row.created_at > lastCreatedAt) {
              lastCreatedAt = row.created_at
              seenAtTimestamp.clear()
            }
            seenAtTimestamp.add(row.id)
            send(`data: ${JSON.stringify({
              type: 'action',
              agentId: row.agent_id,
              agentName: row.agent_name,
              actionType: row.action_type,
              detail: row.detail,
              created_at: row.created_at,
            })}\n\n`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown stream error'
          send(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`)
        }
      }

      send(': connected\n\n')
      poll()

      const pollTimer = setInterval(poll, 2000)
      const pingTimer = setInterval(() => send(': ping\n\n'), 15000)
      c.req.raw.signal.addEventListener('abort', cleanup, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})

app.get('/api/metrics', (c) => {
  const lastHour = oneHourAgo()
  const activeAgents = sqlite.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'").get() as { count: number }
  const postsLastHour = sqlite.prepare('SELECT COUNT(*) as count FROM posts WHERE created_at > ?').get(lastHour) as { count: number }
  const actionsLastHour = sqlite.prepare('SELECT COUNT(*) as count FROM simulation_log WHERE created_at > ?').get(lastHour) as { count: number }
  const lastAction = sqlite.prepare('SELECT MAX(created_at) as last_action_at FROM simulation_log').get() as { last_action_at: number | null }
  const errorRate = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errored
    FROM simulation_log
    WHERE created_at > ?
  `).get(lastHour) as { total: number; errored: number | null }

  return c.json({
    active_agents: safeNumber(activeAgents?.count),
    posts_last_hour: safeNumber(postsLastHour?.count),
    actions_last_hour: safeNumber(actionsLastHour?.count),
    last_action_at: lastAction?.last_action_at ?? null,
    error_rate_1h: safeNumber(errorRate?.total) === 0 ? 0 : safeNumber(errorRate?.errored) / safeNumber(errorRate.total),
    loop_status: readLoopStatus(),
  })
})

app.post('/api/sim/pause', (c) => c.json(writeLoopStatus('paused')))
app.post('/api/sim/resume', (c) => c.json(writeLoopStatus('running')))

// Serve static assets from ui/dist (MUST be after all API routes)
app.get('/assets/*', async (c) => {
  const path = c.req.path
  const file = Bun.file(`./ui/dist${path}`)
  if (!(await file.exists())) return c.notFound()
  const ext = path.split('.').pop() ?? ''
  const mime: Record<string, string> = {
    js: 'application/javascript', mjs: 'application/javascript',
    css: 'text/css', html: 'text/html', svg: 'image/svg+xml',
    png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2',
  }
  return new Response(file, { headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream' } })
})

// SPA fallback — serve index.html for all non-API routes
app.get('*', async (c) => {
  const file = Bun.file('./ui/dist/index.html')
  if (await file.exists()) return new Response(file, { headers: { 'Content-Type': 'text/html' } })
  return c.text('UI not built — run: cd ui && npm run build')
})

void db

export default app
