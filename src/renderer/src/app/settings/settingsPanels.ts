import type { Component } from 'vue'
import TabletView from '../TabletView.vue'
import AiSection from './AiSection.vue'
import AttributesSection from './AttributesSection.vue'
import BrowserSection from './BrowserSection.vue'
import GeneralSection from './GeneralSection.vue'
import InterfaceSection from './InterfaceSection.vue'
import JiraSection from './JiraSection.vue'
import KindsSection from './KindsSection.vue'
import LookSection from './LookSection.vue'
import OutlookSection from './OutlookSection.vue'
import ScheduleSection from './ScheduleSection.vue'
import VoiceSection from './VoiceSection.vue'
import type { SettingsCategoryId } from './settingsCategories'

/** One panel of the settings screen: the section it is shown in, its component, how it is kept. */
export interface SettingsPanel {
  id: string
  category: SettingsCategoryId
  component: Component
  props?: Record<string, unknown>
  /** 'always' — made at once and hidden while another section is open; 'whenOpen' — made only while open (heavy). */
  mount: 'always' | 'whenOpen'
}

/** The panels in the page's order (a section may have several: «Основное» — the schedule on top, the rest below). */
export const SETTINGS_PANELS: SettingsPanel[] = [
  { id: 'schedule', category: 'general', component: ScheduleSection, mount: 'always' },
  { id: 'kinds', category: 'kinds', component: KindsSection, mount: 'always' },
  { id: 'attributes', category: 'attributes', component: AttributesSection, mount: 'always' },
  { id: 'look', category: 'look', component: LookSection, mount: 'always' },
  { id: 'interface', category: 'ui', component: InterfaceSection, mount: 'always' },
  { id: 'tablet', category: 'tablet', component: TabletView, props: { embedded: true }, mount: 'whenOpen' },
  { id: 'outlook', category: 'outlook', component: OutlookSection, mount: 'always' },
  { id: 'browser', category: 'browser', component: BrowserSection, mount: 'always' },
  { id: 'ai', category: 'ai', component: AiSection, mount: 'always' },
  { id: 'jira', category: 'jira', component: JiraSection, mount: 'always' },
  { id: 'voice', category: 'voice', component: VoiceSection, mount: 'always' },
  { id: 'general', category: 'general', component: GeneralSection, mount: 'always' },
]
