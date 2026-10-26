import type { Entry, DayData, KindDef } from '../shared/types'
import type { JiraIssue } from '../shared/jira'
import type { VaultNode } from '../shared/vault'
import type { McpTool } from './mcp'
import { notesTools } from './tools/notesTools'
import { runTools } from './tools/runTools'
import { workTools } from './tools/workTools'

/**
 * The tools Qvarch gives an AI assistant. Reading and running — always; writing notes and keeping the time —
 * allowed beforehand (the user's choice); tests against hosts off the allowed list (*-dev, *-qa…) — the user is
 * asked, with a warning. Time is never deleted or moved — only created and extended.
 */
export interface ToolCtx {
  tree: () => VaultNode[]
  mkdir: (dir: string, name: string) => string
  issue: (key: string) => JiraIssue | undefined
  findIssues: (q: string) => JiraIssue[]
  day: (day: string) => DayData
  saveEntry: (day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }) => Entry
  openInBrowser: (url: string) => void
  /** A page of the built-in browser looked at (what may be acted on, with locators): the address given, else the one shown. */
  lookAtPage: (url?: string) => Promise<string>
  /** The app's window does it (the notes live there): read, write, create, run, report, refresh. */
  ui: <T>(op: string, args: Record<string, unknown>) => Promise<T>
  /** The kinds of work (which are work, their names). */
  kinds: () => KindDef[]
  allow: () => string[]
  /** Hosts off the list: the user says yes or no. */
  confirmHosts: (hosts: string[], note: string) => Promise<boolean>
}

/** Every tool, by area. */
export const qvarchTools = (c: ToolCtx): McpTool[] => [...notesTools(c), ...runTools(c), ...workTools(c)]
