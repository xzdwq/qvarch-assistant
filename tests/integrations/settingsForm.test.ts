import { describe, expect, it } from 'vitest'
import type { PublicSettings } from '../../src/shared/types'
import { DEFAULT_UI } from '../../src/shared/ui'
import { settingsFormFrom, settingsPatchFrom, uiPresetPrefs } from '../../src/shared/settingsForm'

/** Saved settings as the screen opens with them. */
function savedSettings(): PublicSettings {
  return {
    schedule: { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00', workDays: [1, 2, 3, 4, 5] },
    kinds: [
      { id: 'work', label: 'Работа', color: '#6366f1', icon: 'tag' },
      { id: 'break', label: 'Перерыв', color: '#94a3b8', icon: 'coffee' },
      { id: 'review', label: 'Ревью', color: '#14b8a6', icon: 'eye', productive: false },
    ],
    captureTitles: false,
    countKeys: true,
    jira: { clientId: 'app-id', projects: ['ABC', 'XYZ'], syncMin: 15 },
    outlook: { source: 'local', syncMin: 10, meetings: true, presence: false },
    voice: { enabled: true, autoTranscribe: false, model: 'small' },
    idleThresholdSec: 900,
    sampleIntervalMs: 3000,
    autoStart: true,
    island: { opacity: 0.85 },
    ui: JSON.parse(JSON.stringify(DEFAULT_UI)),
  } as PublicSettings
}

describe('settings form', () => {
  it('opens with the saved settings in the form units', () => {
    const f = settingsFormFrom(savedSettings())
    expect(f.idleMin).toBe(15)
    expect(f.sampleSec).toBe(3)
    expect(f.pillOpacity).toBe(85)
    expect(f.jiraProjects).toBe('ABC, XYZ')
    expect(f.jiraSecret).toBe('')
    expect(f.micId).toBe('')
    // every kind gets an explicit productive flag: break is not productive, an unset one is
    expect(f.kinds.map((k) => k.productive)).toEqual([true, false, false])
  })

  it('a missing opacity and sync interval fall back to the defaults', () => {
    const s = savedSettings()
    s.island = {}
    s.jira = { projects: [], syncMin: undefined as unknown as number }
    const f = settingsFormFrom(s)
    expect(f.pillOpacity).toBe(100)
    expect(f.jiraSyncMin).toBe(10)
    expect(f.jiraClientId).toBe('')
  })

  it('saves the form back as settings: units, trimmed names, project keys from links', () => {
    const f = settingsFormFrom(savedSettings())
    f.idleMin = 0
    f.sampleSec = 2
    f.kinds[0].label = '  Работа  '
    f.kinds.push({ id: 'k1', label: '   ', color: '#fff', icon: 'tag', productive: true })
    f.jiraClientId = '  '
    f.jiraProjects = 'abc, https://site.example/jira/software/projects/QQ/boards/1; abc'
    const p = settingsPatchFrom(f)
    expect(p.idleThresholdSec).toBe(60)
    expect(p.sampleIntervalMs).toBe(2000)
    expect(p.kinds?.map((k) => k.label)).toEqual(['Работа', 'Перерыв', 'Ревью'])
    expect(p.jira).toEqual({ clientId: undefined, projects: ['ABC', 'QQ'], syncMin: 15 })
    expect(p.island).toEqual({ opacity: 0.85 })
    // the secret never goes into the settings
    expect(JSON.stringify(p)).not.toContain('jiraSecret')
  })

  it('the minimal preset hides the extras but keeps the timeline, the look and the menu', () => {
    const ui = savedSettings().ui
    ui.timeline.stepSec = 120
    const min = uiPresetPrefs('minimal', ui)
    expect(min.pill.combo).toBe(false)
    expect(min.main.allStats).toBe(false)
    expect(min.timeline.stepSec).toBe(120)
    expect(min.timeline).not.toBe(ui.timeline)
    expect(min.theme).toBe(ui.theme)
    expect(min.menu).toBe(ui.menu)
    const full = uiPresetPrefs('full', ui)
    expect(full.main.allStats).toBe(true)
    expect(full.pill).toEqual(DEFAULT_UI.pill)
  })
})
