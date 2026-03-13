import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import app from './index.ts'

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port })
console.log(`🌐 Slopin API running on http://localhost:${port}`)
void serveStatic
