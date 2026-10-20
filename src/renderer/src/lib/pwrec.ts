import { shallowRef } from 'vue'
import type { PwRecState } from '@shared/browser'
import { findBlocks } from '@shared/noteBlocks'
import { parseInfo } from '@shared/runbook'
import { doc, openFile, save, setText } from './notebook'
import { runKey } from './runbook'

/**
 * Recording a Playwright scenario: a block's «Записать» opens its address in the Браузер, the clicks and typing
 * there become lines; «Стоп» puts them into the block (an empty / sample block — instead of its code, else after
 * it) and brings the note back.
 */
export const pwRec = shallowRef<PwRecState>()
let started = false
export function watchPwRec(): void {
  if (started) return
  started = true
  void window.qa.browser('pwRecState').then((s) => (pwRec.value = s))
  window.qa.onBrowser((type, p) => type === 'pwrec' && (pwRec.value = p as PwRecState | undefined))
}
/** A section of the window shown (App listens). */
export const showView = (view: string) => window.dispatchEvent(new CustomEvent('qa:view', { detail: view }))

export async function startPwRec(path: string, key: string, url: string): Promise<void> {
  watchPwRec()
  await window.qa.browser('pwRecStart', path, key, url)
  showView('browser')
}

const SAMPLE = /^\s*(await page\.goto\('https:\/\/example\.com'\)[\s\S]*)?$/
/** Stopped: the lines into the note's block, the note opened. */
export async function stopPwRec(cancel = false): Promise<string | undefined> {
  const r = await window.qa.browser('pwRecStop', cancel)
  if (!r) return undefined
  const d = doc(r.note)
  for (let i = 0; i < 100 && !d.loaded; i++) await new Promise((res) => setTimeout(res, 30))
  const lines = d.text.split('\n')
  const b = findBlocks(lines).find((x) => {
    if (x.kind !== 'pw') return false
    const info = parseInfo(x.src.split('\n')[0].replace(/^(`{3,}|~{3,})/, ''))
    return runKey(info.name, 'pw', x.line0) === r.key
  })
  const code = r.lines.join('\n')
  if (!b) {
    // the block is gone (renamed, deleted): a new one at the end
    setText(r.note, `${d.text.replace(/\n*$/, '')}\n\n\`\`\`ts playwright session\n${code}\n\`\`\`\n`)
  } else {
    const head = lines[b.line0 - 1]
    const body = lines.slice(b.line0, b.line1 - 1).join('\n')
    const stamp = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const next = SAMPLE.test(body) ? code : `${body.replace(/\n*$/, '')}\n// записано ${stamp}\n${code}`
    // the recording was made with the Браузер's sign-in — the block runs with it too
    const info = /\bsession\b/.test(head) ? head : `${head} session`
    lines.splice(b.line0 - 1, b.line1 - b.line0 + 1, info, ...next.split('\n'), lines[b.line1 - 1])
    setText(r.note, lines.join('\n'))
  }
  await save(r.note)
  openFile(r.note)
  showView('notebook')
  return r.note
}
