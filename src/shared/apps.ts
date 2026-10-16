/** The call app holding the microphone (a mic user's name as Windows reports it) — undefined: not a call app. */
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
