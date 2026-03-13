export interface ProviderRequest {
  system: string
  user: string
  model?: string
  temperature?: number
}
export interface Provider {
  generateText(req: ProviderRequest): Promise<string>
}
