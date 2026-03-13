import { relations } from "drizzle-orm"
import { type AnySQLiteColumn, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

import { nanoid, now } from "./helpers"

const agentStatuses = ["active", "dormant"] as const
const memoryTypes = ["observation", "reflection", "event"] as const
const postTypes = ["post", "pitch", "comment"] as const
const relationshipTypes = ["follows", "admires", "rivals"] as const

export const agents = sqliteTable("agents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  name: text("name").notNull(),
  headline: text("headline").notNull(),
  background: text("background").notNull(),
  specialty: text("specialty").notNull(),
  personality: text("personality").notNull().default("[]"),
  values: text("values").notNull().default("[]"),
  current_focus: text("current_focus"),
  status: text("status", { enum: agentStatuses }).notNull().default("active"),
  energy: real("energy").notNull().default(1.0),
  action_count: integer("action_count").notNull().default(0),
  last_active_at: integer("last_active_at").notNull().$defaultFn(() => now()),
  created_at: integer("created_at").notNull().$defaultFn(() => now()),
})

export const memories = sqliteTable("memories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  importance: integer("importance").notNull(),
  type: text("type", { enum: memoryTypes }).notNull(),
  created_at: integer("created_at").notNull().$defaultFn(() => now()),
})

export const posts = sqliteTable("posts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  type: text("type", { enum: postTypes }).notNull().default("post"),
  parent_id: text("parent_id").references((): AnySQLiteColumn => posts.id, { onDelete: "cascade" }),
  reactions: text("reactions").notNull().default("{}"),
  created_at: integer("created_at").notNull().$defaultFn(() => now()),
})

export const relationships = sqliteTable(
  "relationships",
  {
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    target_id: text("target_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    type: text("type", { enum: relationshipTypes }).notNull(),
    strength: real("strength").notNull().default(0.5),
    updated_at: integer("updated_at").notNull().$defaultFn(() => now()),
  },
  (table) => [primaryKey({ columns: [table.agent_id, table.target_id] })],
)

export const agentQueue = sqliteTable("agent_queue", {
  agent_id: text("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  wake_at: integer("wake_at").notNull(),
})

export const simulationLog = sqliteTable("simulation_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  agent_id: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  action_type: text("action_type").notNull(),
  detail: text("detail").notNull(),
  tokens_used: integer("tokens_used").notNull().default(0),
  error: text("error"),
  created_at: integer("created_at").notNull().$defaultFn(() => now()),
})

export const agentsRelations = relations(agents, ({ many, one }) => ({
  memories: many(memories),
  posts: many(posts),
  outgoingRelationships: many(relationships, { relationName: "sourceAgent" }),
  incomingRelationships: many(relationships, { relationName: "targetAgent" }),
  queueEntry: one(agentQueue),
  simulationLogs: many(simulationLog),
}))

export const memoriesRelations = relations(memories, ({ one }) => ({
  agent: one(agents, {
    fields: [memories.agent_id],
    references: [agents.id],
  }),
}))

export const postsRelations = relations(posts, ({ one, many }) => ({
  agent: one(agents, {
    fields: [posts.agent_id],
    references: [agents.id],
  }),
  parent: one(posts, {
    fields: [posts.parent_id],
    references: [posts.id],
    relationName: "postThread",
  }),
  replies: many(posts, { relationName: "postThread" }),
}))

export const relationshipsRelations = relations(relationships, ({ one }) => ({
  agent: one(agents, {
    fields: [relationships.agent_id],
    references: [agents.id],
    relationName: "sourceAgent",
  }),
  target: one(agents, {
    fields: [relationships.target_id],
    references: [agents.id],
    relationName: "targetAgent",
  }),
}))

export const agentQueueRelations = relations(agentQueue, ({ one }) => ({
  agent: one(agents, {
    fields: [agentQueue.agent_id],
    references: [agents.id],
  }),
}))

export const simulationLogRelations = relations(simulationLog, ({ one }) => ({
  agent: one(agents, {
    fields: [simulationLog.agent_id],
    references: [agents.id],
  }),
}))

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
export type Relationship = typeof relationships.$inferSelect
export type NewRelationship = typeof relationships.$inferInsert
export type AgentQueueEntry = typeof agentQueue.$inferSelect
export type NewAgentQueueEntry = typeof agentQueue.$inferInsert
export type SimulationLog = typeof simulationLog.$inferSelect
export type NewSimulationLog = typeof simulationLog.$inferInsert
