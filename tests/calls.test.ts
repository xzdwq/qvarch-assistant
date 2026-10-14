import { describe, expect, it } from 'vitest'
import { callLabel, callTitle, cleanCallTitle } from '../src/shared/calls'

describe('call title', () => {
  it('strips the app suffix', () => {
    expect(cleanCallTitle('Иванов Иван | Microsoft Teams')).toBe('Иванов Иван')
    expect(cleanCallTitle('Zoom Meeting - Zoom')).toBe('Zoom Meeting')
  })
  it('skips main-window sections, prefers a window that appeared with the call', () => {
    const w = ['ms-teams\tЧат | Петров Пётр | Microsoft Teams', 'ms-teams\tMicrosoft Teams', 'ms-teams\tИванов Иван | Microsoft Teams']
    expect(callTitle('Teams', w)).toBe('Иванов Иван')
    const both = [...w, 'ms-teams\tПланёрка | Microsoft Teams']
    expect(callTitle('Teams', both, new Set(['Иванов Иван | Microsoft Teams']))).toBe('Планёрка')
  })
  it('only the call app\'s own windows; none → undefined', () => {
    expect(callTitle('Teams', ['Telegram\tИванов Иван'])).toBeUndefined()
    expect(callTitle('Браузер (звонок)', ['chrome\tMeet'])).toBeUndefined()
  })
  it('label', () => {
    expect(callLabel({ start: 0, end: 1, app: 'Teams', source: 'mic' })).toBe('Созвон Teams')
    expect(callLabel({ start: 0, end: 1, app: 'Teams', source: 'mic', title: 'Иванов Иван' })).toBe('Созвон: Иванов Иван')
  })
})
