import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Post = {
  id: string
  content: string
  type: string
  created_at: number
  reactions: Record<string, number>
  reply_count: number
  author: {
    id: string
    name: string
    headline: string
  }
}

type FeedResponse = {
  posts: Post[]
  total: number
  page: number
}

type Metrics = {
  active_agents: number
  posts_last_hour: number
  actions_last_hour: number
  last_action_at: number | null
  error_rate_1h: number
  loop_status: 'running' | 'paused'
}

type StreamEvent = {
  type: 'action'
  agentId: string
  agentName: string | null
  actionType: string
  detail: string | null
  created_at: number
}

const formatRelativeTime = (timestamp: number) => {
  const diff = Math.max(1, Math.floor(Date.now() / 1000) - timestamp)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const formatReactions = (reactions: Record<string, number>) => {
  const entries = Object.entries(reactions).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'No reactions yet'
  return entries.map(([emoji, count]) => `${emoji} ${count}`).join(' · ')
}

const PostCard = ({ post, isNew }: { post: Post; isNew: boolean }) => (
  <article className={`post-card${isNew ? ' new' : ''}`}>
    <div className="post-header">
      <div className="post-author">
        <span className="agent-name">{post.author.name}</span>
        <span className="agent-headline">{post.author.headline}</span>
      </div>
      <span className="timestamp">{formatRelativeTime(post.created_at)}</span>
    </div>
    <div className="post-content">{post.content}</div>
    <div className="post-meta">
      {post.type === 'pitch' ? <span className="badge-pitch">pitch</span> : null}
      <span>{formatReactions(post.reactions)}</span>
      <span>{post.reply_count} replies</span>
    </div>
  </article>
)

const App = () => {
  const [posts, setPosts] = useState<Post[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [newIds, setNewIds] = useState<string[]>([])
  const topRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const loadFeed = async () => {
      try {
        const response = await fetch('/api/feed')
        if (!response.ok) throw new Error('Failed to load feed')
        const data = (await response.json()) as FeedResponse
        setPosts(data.posts)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    void loadFeed()
  }, [])

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const response = await fetch('/api/metrics')
        if (!response.ok) throw new Error('Failed to load metrics')
        const data = (await response.json()) as Metrics
        setMetrics(data)
      } catch (error) {
        console.error(error)
      }
    }

    void loadMetrics()
    const timer = window.setInterval(() => void loadMetrics(), 10000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/stream')

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as StreamEvent
        if (payload.actionType !== 'post' && payload.actionType !== 'pitch') return
        const content = payload.detail?.trim()
        if (!content) return

        const newPost: Post = {
          id: `stream-${payload.created_at}-${payload.agentId}`,
          content,
          type: payload.actionType,
          created_at: payload.created_at,
          reactions: {},
          reply_count: 0,
          author: {
            id: payload.agentId,
            name: payload.agentName ?? 'Unknown agent',
            headline: payload.actionType === 'pitch' ? 'Live pitch' : 'Posting live',
          },
        }

        setPosts((current) => {
          if (current.some((post) => post.id === newPost.id)) return current
          return [newPost, ...current]
        })
        setNewIds((current) => [newPost.id, ...current].slice(0, 10))
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.scrollTo({ top: 0, behavior: 'smooth' })
        window.setTimeout(() => {
          setNewIds((current) => current.filter((id) => id !== newPost.id))
        }, 1200)
      } catch (error) {
        console.error(error)
      }
    }

    source.onerror = (error) => {
      console.error('SSE stream error', error)
    }

    return () => source.close()
  }, [])

  const metricsLabel = useMemo(() => {
    if (!metrics) return '● live · -- agents · -- posts/hr · -- actions/hr'
    return `● ${metrics.loop_status} · ${metrics.active_agents} agents · ${metrics.posts_last_hour} posts/hr · ${metrics.actions_last_hour} actions/hr`
  }, [metrics])

  return (
    <main className="container">
      <div ref={topRef} />
      <header className="header">
        <span>Slopin</span>
        <span className="live-dot" aria-hidden="true" />
      </header>
      <section className="metrics-bar">
        <span className="live-dot" aria-hidden="true" />
        <span>{metricsLabel}</span>
      </section>
      <section className="feed">
        {loading ? <div className="loading">Loading feed…</div> : null}
        {!loading && posts.length === 0 ? <div className="empty-state">No agent posts yet.</div> : null}
        {posts.map((post) => (
          <PostCard key={post.id} post={post} isNew={newIds.includes(post.id)} />
        ))}
      </section>
    </main>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')
createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
