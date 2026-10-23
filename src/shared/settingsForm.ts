import type { PublicSettings, SettingsPatch, UiPrefs } from './types'
import { isProductive } from './kinds'
import { projectKeys } from './jira'
import { DEFAULT_UI } from './ui'

/** The settings screen's form, from the saved settings (what «Сохранить» keeps; some fields apply at once). */
export function settingsFormFrom(s: PublicSettings) {
  return {
    schedule: { ...s.schedule },
    // every kind gets an explicit productive flag in the form (break/lunch default to false)
    kinds: s.kinds.map((k) => ({ ...k, productive: isProductive(s.kinds, k.id) })),
    captureTitles: s.captureTitles,
    countKeys: s.countKeys,
    pillOpacity: Math.round((s.island.opacity ?? 1) * 100),
    jiraClientId: s.jira.clientId ?? '',
    jiraProjects: s.jira.projects.join(', '),
    /** Typed to replace the stored one; it goes to the encrypted store, never into the settings. */
    jiraSecret: '',
    voiceEnabled: s.voice.enabled,
    autoTranscribe: s.voice.autoTranscribe,
    voiceModel: s.voice.model,
    micId: s.voice.micId ?? '',
    jiraSyncMin: s.jira.syncMin ?? 10,
    idleMin: Math.round(s.idleThresholdSec / 60),
    sampleSec: s.sampleIntervalMs / 1000,
    autoStart: s.autoStart,
  }
}
export type SettingsForm = ReturnType<typeof settingsFormFrom>

/** What «Сохранить» sends: the form as settings (empty kinds dropped, minimums kept; no secret). */
export function settingsPatchFrom(f: SettingsForm): SettingsPatch {
  return {
    schedule: { ...f.schedule },
    kinds: f.kinds.filter((k) => k.label.trim()).map((k) => ({ ...k, label: k.label.trim() })),
    idleThresholdSec: Math.max(1, f.idleMin) * 60,
    sampleIntervalMs: Math.max(1, f.sampleSec) * 1000,
    autoStart: f.autoStart,
    captureTitles: f.captureTitles,
    countKeys: f.countKeys,
    island: { opacity: f.pillOpacity / 100 },
    jira: { clientId: f.jiraClientId.trim() || undefined, projects: projectKeys(f.jiraProjects), syncMin: f.jiraSyncMin },
    voice: { enabled: f.voiceEnabled, autoTranscribe: f.autoTranscribe, model: f.voiceModel, micId: f.micId },
  }
}

export type UiPreset = 'full' | 'minimal'
/** The interface presets: everything, or only what is needed day to day (the timeline, the look and the menu stay). */
const UI_PRESETS: Record<UiPreset, (ui: UiPrefs) => UiPrefs> = {
  full: (ui) => ({ ...DEFAULT_UI, main: { ...DEFAULT_UI.main, allStats: true }, timeline: { ...ui.timeline }, theme: ui.theme, menu: ui.menu }),
  minimal: (ui) => ({
    pill: { app: true, date: false, combo: false, wave: false, chips: true, stats: false, dayBar: true, plan: false },
    dock: { orb: true, time: true, next: true, wave: false },
    island: { date: false, wave: false, totals: true, plan: false },
    main: { allStats: false, plan: true },
    timeline: { ...ui.timeline },
    theme: ui.theme,
    menu: ui.menu,
  }),
}
export const uiPresetPrefs = (p: UiPreset, ui: UiPrefs): UiPrefs => UI_PRESETS[p](ui)
