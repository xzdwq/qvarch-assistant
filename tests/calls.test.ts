import { describe, expect, it } from 'vitest'
import { callLabel, callTitle, cleanCallTitle } from '../src/shared/calls'

describe('call title', () => {
  it('strips the app suffix', () => {
    expect(cleanCallTitle('Альфа Иван | Microsoft Teams')).toBe('Альфа Иван')
    expect(cleanCallTitle('Zoom Meeting - Zoom')).toBe('Zoom Meeting')
  })
  it('skips main-window sections, prefers a window that appeared with the call', () => {
    const w = ['ms-teams\tЧат | Бета Пётр | Microsoft Teams', 'ms-teams\tMicrosoft Teams', 'ms-teams\tАльфа Иван | Microsoft Teams']
    expect(callTitle('Teams', w)).toBe('Альфа Иван')
    const both = [...w, 'ms-teams\tПланёрка | Microsoft Teams']
    expect(callTitle('Teams', both, new Set(['Альфа Иван | Microsoft Teams']))).toBe('Планёрка')
  })
  it('only the call app\'s own windows; none → undefined', () => {
    expect(callTitle('Teams', ['Telegram\tАльфа Иван'])).toBeUndefined()
    expect(callTitle('Браузер (звонок)', ['chrome\tMeet'])).toBeUndefined()
  })
  it('label', () => {
    expect(callLabel({ start: 0, end: 1, app: 'Teams', source: 'mic' })).toBe('Созвон Teams')
    expect(callLabel({ start: 0, end: 1, app: 'Teams', source: 'mic', title: 'Альфа Иван' })).toBe('Созвон: Альфа Иван')
  })
})
