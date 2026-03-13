import type { Config } from "drizzle-kit"
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DB_PATH ?? "./data/slopin.db" },
} satisfies Config
