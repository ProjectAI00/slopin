import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import type { Provider, ProviderRequest } from './types.ts'

type CopilotSDK = typeof import('@github/copilot-sdk')
type CopilotClientInstance = InstanceType<CopilotSDK['CopilotClient']>
type CopilotSession = Awaited<ReturnType<CopilotClientInstance['createSession']>>

let clientPromise: Promise<CopilotClientInstance> | null = null

function selectModel(model?: string): string {
  return model ?? process.env.COPILOT_MODEL_FAST ?? 'gpt-4.1-mini'
}

function selectCliModel(model?: string): string {
  const selected = selectModel(model)
  return selected === 'gpt-4.1-mini' ? 'gpt-4.1' : selected
}

function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (
          typeof entry === 'object' &&
          entry !== null &&
          'type' in entry &&
          entry.type === 'text' &&
          'text' in entry &&
          typeof entry.text === 'string'
        ) {
          return entry.text
        }
        return ''
      })
      .join('')
  }

  if (
    typeof content === 'object' &&
    content !== null &&
    'text' in content &&
    typeof content.text === 'string'
  ) {
    return content.text
  }

  return ''
}

async function hasGitHubAuth(): Promise<boolean> {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return true
  }

  const home = process.env.HOME
  if (home) {
    const configPath = `${home}/.copilot/config.json`
    if (existsSync(configPath)) {
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
          logged_in_users?: unknown[]
        }
        if (Array.isArray(parsed.logged_in_users) && parsed.logged_in_users.length > 0) {
          return true
        }
      } catch {
        // Ignore parse errors and fall back to gh auth status.
      }
    }
  }

  return new Promise<boolean>((resolve) => {
    const proc = spawn('gh', ['auth', 'status'])
    proc.on('close', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

async function getCopilotClient(): Promise<CopilotClientInstance> {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const sdk = await import('@github/copilot-sdk')
        const client = new sdk.CopilotClient({
          autoStart: true,
          autoRestart: true,
        })
        await client.start()
        return client
      } catch (error) {
        clientPromise = null
        const message = error instanceof Error ? error.message : 'Unknown Copilot SDK error'
        throw new Error(
          `GitHub Copilot SDK is unavailable. Install @github/copilot-sdk before using the Copilot provider. (${message})`,
        )
      }
    })()
  }

  return clientPromise
}

function buildCliPrompt(request: ProviderRequest): string {
  return `${request.system.trim()}\n\nUser request:\n${request.user.trim()}`
}

async function runCopilotCliPrompt(request: ProviderRequest): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(
      'copilot',
      ['-s', '--no-custom-instructions', '--model', selectCliModel(request.model), '-p', buildCliPrompt(request)],
      {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', (error) => reject(error))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `copilot CLI fallback failed with exit code ${code}: ${stderr.trim() || 'no error output'}`,
          ),
        )
        return
      }

      const text = stdout.trim()
      if (!text) {
        reject(new Error('copilot CLI fallback returned an empty response'))
        return
      }

      resolve(text)
    })
  })
}

async function runCopilotSession(session: CopilotSession, prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = ''
    let sawDelta = false
    let settled = false

    const cleanup = (unsubscribe?: (() => void) | void) => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }

    const unsubscribe = session.on((event: { type: string; data?: any }) => {
      switch (event.type) {
        case 'assistant.message_delta':
          sawDelta = true
          text += event.data?.deltaContent ?? ''
          break
        case 'assistant.message':
          if (!sawDelta) {
            text += extractText(event.data?.content ?? event.data?.message ?? event.data)
          }
          break
        case 'session.error':
          if (!settled) {
            settled = true
            cleanup(unsubscribe)
            reject(new Error(event.data?.message ?? 'Unknown Copilot session error'))
          }
          break
        case 'session.idle':
          if (!settled) {
            settled = true
            cleanup(unsubscribe)
            const trimmed = text.trim()
            if (!trimmed) {
              reject(new Error('Copilot returned an empty response'))
              return
            }
            resolve(trimmed)
          }
          break
      }
    })

    void session.send({ prompt }).catch((error: unknown) => {
      if (!settled) {
        settled = true
        cleanup(unsubscribe)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

export const copilotProvider: Provider = {
  async generateText(request: ProviderRequest): Promise<string> {
    if (!(await hasGitHubAuth())) {
      throw new Error(
        'GitHub Copilot authentication is required. Run `gh auth login` or `copilot /login` before using this provider.',
      )
    }

    try {
      const client = await getCopilotClient()
      const session = await client.createSession({
        model: selectModel(request.model),
        streaming: true,
        onPermissionRequest: () => ({ kind: 'approved' }),
        systemMessage: {
          mode: 'replace',
          content: request.system,
        },
      })

      return await runCopilotSession(session, request.user)
    } catch {
      return runCopilotCliPrompt(request)
    }
  },
}
