import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDayModel, DEFAULT_AI_PROMPT } from '../shared/aimodel'
import type { DayData, Settings } from '../shared/types'

/**
 * Day analysis with OpenAI: a compact model of the day + the prompt from settings → a Markdown summary,
 * stored on the day. The API key is encrypted with the OS (safeStorage / DPAPI) in ai-secrets.bin.
 */
export class Ai {
  private key?: string
  private file: string

  constructor(root: string) {
    this.file = join(root, 'ai-secrets.bin')
    if (existsSync(this.file) && safeStorage.isEncryptionAvailable()) {
      try {
        this.key = (JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as { key?: string }).key
      } catch {
        this.key = undefined
      }
    }
  }

  get hasKey(): boolean {
    return !!this.key
  }

  setKey(key: string): void {
    this.key = key.trim() || undefined
    if (!this.key) return rmSync(this.file, { force: true })
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — ключ не сохранён')
    writeFileSync(`${this.file}.tmp`, safeStorage.encryptString(JSON.stringify({ key: this.key })))
    renameSync(`${this.file}.tmp`, this.file)
  }

  /** The exact JSON that would be sent (for the "what is sent" preview). */
  model(d: DayData, settings: Settings): string {
    return JSON.stringify(buildDayModel(d, settings, Date.now(), settings.ai.sendTitles))
  }

  async analyze(d: DayData, settings: Settings): Promise<{ at: number; model: string; text: string }> {
    if (!this.key) throw new Error('Укажите ключ OpenAI в настройках')
    const model = settings.ai.model.trim() || 'gpt-4.1-mini'
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: settings.ai.prompt.trim() || DEFAULT_AI_PROMPT },
          { role: 'user', content: this.model(d, settings) },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    const data = (await res.json().catch(() => ({}))) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message ?? 'ошибка запроса'}`)
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('OpenAI вернул пустой ответ')
    return { at: Date.now(), model, text }
  }
}
