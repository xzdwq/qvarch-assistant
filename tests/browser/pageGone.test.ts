import { describe, expect, it } from 'vitest'
import { exitCodeText, goneReasonText, GONE_REASON_TEXT, restartOrigin } from '../../src/shared/browser/pageGone'

describe("a page's process gone", () => {
  it('each reason told; an unknown one in general', () => {
    expect(goneReasonText('oom')).toBe(GONE_REASON_TEXT.oom)
    expect(goneReasonText('integrity-failure')).toMatch(/антивирус/)
    expect(goneReasonText('something-new')).toBe('Процесс страницы завершился.')
    expect(goneReasonText('constructor')).toBe('Процесс страницы завершился.')
  })
  it('an exit code: NTSTATUS as hex (signed or not), named when known; small as is; none — empty', () => {
    expect(exitCodeText(-1073741819)).toBe('0xC0000005 — нарушение доступа к памяти')
    expect(exitCodeText(3221225477)).toBe('0xC0000005 — нарушение доступа к памяти')
    expect(exitCodeText(-536870904)).toBe('0xE0000008 — не хватило памяти')
    expect(exitCodeText(0x12345678)).toBe('0x12345678')
    expect(exitCodeText(1)).toBe('1')
    expect(exitCodeText(0)).toBe('')
    expect(exitCodeText(NaN)).toBe('')
  })
  it("the site cleared on restart: http(s) only, the page's origin", () => {
    expect(restartOrigin('http://localhost:3000/orders?id=1#top')).toBe('http://localhost:3000')
    expect(restartOrigin('https://site.test/a')).toBe('https://site.test')
    expect(restartOrigin('about:blank')).toBeUndefined()
    expect(restartOrigin('file:///C:/a.html')).toBeUndefined()
    expect(restartOrigin('qa-source:https://site.test/')).toBeUndefined()
    expect(restartOrigin('not a url')).toBeUndefined()
  })
})
