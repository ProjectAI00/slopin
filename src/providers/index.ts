import { copilotProvider } from "./copilot.ts"

export const provider = copilotProvider

export async function generateText(system: string, user: string, model?: string): Promise<string> {
  return provider.generateText({ system, user, model })
}
