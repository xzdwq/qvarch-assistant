import type { ActivitySegment, AppKind, Ms } from './types'

interface AppRule {
  match: RegExp
  name: string
  kind: AppKind
}

/** Process name (without .exe) → friendly app name and category. */
const RULES: AppRule[] = [
  { match: /^code(-insiders)?$/i, name: 'VS Code', kind: 'ide' },
  { match: /^cursor$/i, name: 'Cursor', kind: 'ide' },
  { match: /^(idea64|webstorm64|pycharm64|rider64|datagrip64|goland64|phpstorm64|devenv)$/i, name: 'IDE', kind: 'ide' },
  { match: /^(ms-teams|teams|msteams)$/i, name: 'Teams', kind: 'teams' },
  { match: /^(outlook|olk)$/i, name: 'Outlook', kind: 'mail' },
  { match: /^chrome$/i, name: 'Chrome', kind: 'browser' },
  { match: /^msedge$/i, name: 'Edge', kind: 'browser' },
  { match: /^firefox$/i, name: 'Firefox', kind: 'browser' },
  { match: /^(opera|brave|vivaldi|browser|yandex)$/i, name: 'Browser', kind: 'browser' },
  { match: /^(windowsterminal|wt|powershell|pwsh|cmd|mintty|conhost)$/i, name: 'Terminal', kind: 'terminal' },
  { match: /^(winword|excel|powerpnt|onenote)$/i, name: 'Office', kind: 'office' },
  { match: /^(telegram|slack|zoom|skype)$/i, name: 'Messenger', kind: 'chat' },
  { match: /^(lockapp|logonui)$/i, name: 'Экран блокировки', kind: 'locked' },
  { match: /^explorer$/i, name: 'Проводник', kind: 'other' },
  { match: /^applicationframehost$/i, name: 'Приложение Windows', kind: 'other' },
  { match: /^(electron|qvarch assistant)$/i, name: 'Qvarch Assistant', kind: 'other' },
]

export function classifyApp(proc: string): { name: string; kind: AppKind } {
  const p = proc.replace(/\.exe$/i, '')
  for (const r of RULES) if (r.match.test(p)) return { name: r.name === 'Office' ? officeName(p) : r.name, kind: r.kind }
  return { name: p || 'Неизвестно', kind: 'other' }
}

function officeName(p: string): string {
  const map: Record<string, string> = { winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', onenote: 'OneNote' }
  return map[p.toLowerCase()] ?? 'Office'
}

/** Apps whose microphone use means "on a call". Matched against registry key names / exe names. */
export function isCallApp(micUser: string): string | undefined {
  const s = micUser.toLowerCase()
  if (s.includes('msteams') || s.includes('ms-teams') || s.includes('teams.exe')) return 'Teams'
  if (s.includes('zoom')) return 'Zoom'
  if (s.includes('telegram')) return 'Telegram'
  if (s.includes('slack')) return 'Slack'
  if (s.includes('chrome') || s.includes('msedge') || s.includes('firefox')) return 'Браузер (звонок)'
  if (s.includes('skype')) return 'Skype'
  return undefined
}

export interface Sample {
  t: Ms
  app: string
  kind: AppKind
  /** Only when title capture is enabled in settings. */
  title?: string
}

/**
 * Appends a sample to the activity list: extends the last segment when it is the same app
 * and the sample is contiguous (≤ maxGapMs), otherwise opens a new segment.
 * Mutates and returns `list` (main-process hot path).
 */
export function pushSample(list: ActivitySegment[], s: Sample, maxGapMs: number): ActivitySegment[] {
  const last = list[list.length - 1]
  if (last && last.app === s.app && last.kind === s.kind && last.title === s.title && s.t - last.end <= maxGapMs) {
    last.end = s.t
    return list
  }
  const start = last && s.t - last.end <= maxGapMs ? last.end : s.t
  // titles are stored only when the user enabled it — they can contain private text (e.g. an unsaved document)
  list.push(s.title ? { start, end: s.t, app: s.app, kind: s.kind, title: s.title } : { start, end: s.t, app: s.app, kind: s.kind })
  return list
}
