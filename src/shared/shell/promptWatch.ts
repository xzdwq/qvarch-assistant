import { stripAnsi } from './output'

/** A terminal quiet this long after an unended line is taken as asking (ms). */
export const PROMPT_QUIET_MS = 1500
const TAIL_MAX = 400
const PROMPT_MAX = 200

/**
 * A terminal run's output watched for a question: its last line left unended (`[sudo] password for …: `) and nothing
 * more for a while — it waits for an answer. Told once when it starts waiting (the line asked), once when it goes on
 * (more output, an answer sent, the end). A program that only paused mid-line looks the same — said as «похоже».
 */
export class PromptWatch {
  private tail = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private waiting = false

  constructor(
    private readonly tell: (prompt: string | undefined) => void,
    private readonly quietMs = PROMPT_QUIET_MS,
  ) {}

  feed(text: string): void {
    this.tail = stripAnsi(this.tail + text)
      .split('\n')
      .pop()!
      .slice(-TAIL_MAX)
    this.resume()
    const asked = this.tail.replace(/\r/g, '').trim()
    if (asked) this.timer = setTimeout(() => this.ask(asked), this.quietMs)
  }
  /** The person's answer sent: what it asked is answered. */
  answered(): void {
    this.tail = ''
    this.resume()
  }
  /** The run ended. */
  end(): void {
    this.resume()
  }

  private ask(prompt: string): void {
    this.timer = undefined
    this.waiting = true
    this.tell(prompt.slice(-PROMPT_MAX))
  }
  private resume(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.waiting) return
    this.waiting = false
    this.tell(undefined)
  }
}
