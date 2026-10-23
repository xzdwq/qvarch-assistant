import type { Locator } from 'playwright-core'
import { UNSAVED_TEXT } from '../../../shared/check'
import type { Exchange } from '../traffic'
import { ok2, type QaContext } from './qaContext'
import { line, pathOf, plural } from './qaText'

/** Only the fields of a snapshot (its tables' rows left out). */
const fieldsOnly = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([k]) => !/^Таблица \d+, строка/.test(k)))

/**
 * `qa` checks around a form's actions: a save and leaving the page, the page after a reload, a double click, the
 * actions repeated, the fields before and after a switch.
 */
export function formChecks(ctx: QaContext) {
  const { page, step, sent, snaps } = ctx
  return {
    /** The save done by `save`; then the page left (back — or by `leave`): no «unsaved changes» may show. */
    saveAndLeave: (save: () => Promise<unknown>, leave?: () => Promise<unknown>) =>
      step('Проверка: сохранить и уйти', async () => {
        const name = 'Сохранить и уйти'
        await ctx.quiet()
        const from = sent.length
        await save()
        await ctx.quiet()
        const muts = ctx.mutations(from)
        const good = muts.filter(ok2)
        if (!muts.length) return ctx.verdict({ kind: 'leave', name, state: 'fail', summary: 'сохранение не отправило на сервер ни одного запроса (POST / PUT / PATCH / DELETE)' })
        if (!good.length) return ctx.verdict({ kind: 'leave', name, state: 'fail', summary: `сохранение не прошло: ${muts.map(line).join(', ')}`, head: ['Запрос', 'Ответ'], rows: muts.map((x) => [`${x.method} ${pathOf(x.url)}`, String(x.status ?? '…')]) })
        let native = ''
        const onDialog = (d: { message(): string; dismiss(): Promise<void> }) => {
          native = d.message() || 'окно браузера «Покинуть страницу?»'
          void d.dismiss().catch(() => undefined)
        }
        page.on('dialog', onDialog)
        const at = page.url()
        try {
          if (leave) await leave()
          else if (await page.evaluate(() => history.length > 1).catch(() => false)) {
            // back (in an app it is often the same document — no «navigation» for Playwright, the dialog shows anyway)
            await page.goBack({ timeout: 5000 }).catch(() => null)
          } else {
            // nowhere back: away from the site (its own «leave the site?» prompt comes here)
            await page.goto('about:blank', { timeout: 5000 }).catch(() => undefined)
          }
          await page.waitForTimeout(1200)
        } finally {
          page.off('dialog', onDialog)
        }
        const shown = await page
          .evaluate((src) => {
            const rx = new RegExp(src, 'i')
            for (const d of document.querySelectorAll('.q-dialog, [role="dialog"], [role="alertdialog"], .el-message-box, .modal.show, .ant-modal')) {
              const t = (d.textContent ?? '').replace(/\s+/g, ' ').trim()
              if (rx.test(t)) return t.slice(0, 200)
            }
            return ''
          }, UNSAVED_TEXT.source)
          .catch(() => '')
        const saved = good.map(line).join(', ')
        const dialog = shown || native
        // left to an empty tab (back from the scenario's first page — a new tab's history starts at about:blank — or
        // away): the page opened again, so the lines after it (the layout, a reload…) see it, not a blank tab
        if (page.url().startsWith('about:') && !at.startsWith('about:')) {
          await page.goto(at, { timeout: 30000 }).catch(() => undefined)
          await ctx.quiet()
        }
        if (dialog)
          return ctx.verdict({
            kind: 'leave',
            name,
            state: 'fail',
            summary: `после успешного сохранения при уходе со страницы появилось «${dialog}»`,
            head: ['Что', 'Как было'],
            rows: [
              ['Сохранение', saved],
              ['Уход', leave ? 'своим действием' : 'назад'],
              ['Окно', dialog],
            ],
          })
        ctx.verdict({ kind: 'leave', name, state: 'ok', summary: `сохранено (${saved}), со страницы ушли — окна о несохранённых изменениях нет` })
      }),

    /** The page's fields and tables before and after a reload: they must be the same (what was saved stays). */
    sameAfterReload: () =>
      step('Проверка: сравнить с перезагрузкой', async () => {
        const name = 'Сравнить с перезагрузкой'
        if (page.url().startsWith('about:')) return ctx.verdict({ kind: 'reload', name, state: 'warn', summary: `вкладка пустая (${page.url()}) — сравнивать нечего` })
        await ctx.quiet()
        const a = await ctx.snap()
        await page.reload({ waitUntil: 'load' })
        await ctx.quiet(1000, 30000)
        const b = await ctx.snap()
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        const diff = keys.filter((k) => (a[k] ?? '') !== (b[k] ?? '')).map((k) => [k, a[k] ?? '— нет —', b[k] ?? '— нет —'])
        const fields = Object.keys(a).filter((k) => !/^Таблица \d+, строка/.test(k)).length
        const rows = Object.keys(a).length - fields
        if (diff.length) return ctx.verdict({ kind: 'reload', name, state: 'fail', summary: `после перезагрузки страница другая: отличий ${diff.length}`, head: ['Что', 'До перезагрузки', 'После'], rows: diff.slice(0, 40) })
        ctx.verdict({ kind: 'reload', name, state: 'ok', summary: `полей ${fields}, строк таблиц ${rows} — после перезагрузки всё так же` })
      }),

    /** The click twice in a row (as a hurried hand): the same request must not go twice. */
    doubleSubmit: (target: Locator) =>
      step('Проверка: двойной клик', async () => {
        const name = 'Двойной клик по сохранению'
        await ctx.quiet()
        const from = sent.length
        await target.click()
        // the second one at once; a button that went disabled / away refuses it — that is the protection
        await target.click({ timeout: 1500 }).catch(() => undefined)
        await ctx.quiet()
        const muts = ctx.mutations(from)
        const groups = new Map<string, Exchange[]>()
        for (const x of muts) {
          const k = `${x.method} ${x.url} ${x.body ?? ''}`
          groups.set(k, [...(groups.get(k) ?? []), x])
        }
        const twice = [...groups.values()].filter((g) => g.length > 1)
        if (twice.length)
          return ctx.verdict({
            kind: 'double',
            name,
            state: 'fail',
            summary: `ушло два одинаковых запроса: ${twice.map((g) => `${g[0].method} ${pathOf(g[0].url)} ×${g.length}`).join(', ')}`,
            head: ['Запрос', 'Ответы'],
            rows: twice.map((g) => [`${g[0].method} ${pathOf(g[0].url)}`, g.map((x) => String(x.status ?? '…')).join(', ')]),
          })
        if (!muts.length) return ctx.verdict({ kind: 'double', name, state: 'warn', summary: 'клики не отправили запросов на сервер — нечего было дублировать (это точно кнопка сохранения?)' })
        ctx.verdict({ kind: 'double', name, state: 'ok', summary: `второй клик не отправил повтор: ${muts.map(line).join(', ')}` })
      }),

    /** The actions twice in a row: what each time sent and how the tables' rows changed. */
    repeat: (actions: () => Promise<unknown>) =>
      step('Проверка: повторить дважды', async () => {
        const name = 'Повторить действия дважды'
        await ctx.quiet()
        const r0 = await ctx.rowsNow()
        const f1 = sent.length
        await step('1-й раз', actions)
        await ctx.quiet()
        const m1 = ctx.mutations(f1)
        const r1 = await ctx.rowsNow()
        const f2 = sent.length
        await step('2-й раз', actions)
        await ctx.quiet()
        const m2 = ctx.mutations(f2)
        const r2 = await ctx.rowsNow()
        const head = ['Что', '1-й раз', '2-й раз']
        const rows = [
          ['Запросы на изменение', m1.map(line).join('\n') || '—', m2.map(line).join('\n') || '—'],
          ['Строк в таблицах', `${r0} → ${r1}`, `${r1} → ${r2}`],
        ]
        const bad2 = m2.filter((x) => !ok2(x))
        if (bad2.length) return ctx.verdict({ kind: 'repeat', name, state: 'fail', summary: `во 2-й раз сервер ответил ошибкой: ${bad2.map(line).join(', ')}`, head, rows })
        if (r1 > r0 && r2 > r1) return ctx.verdict({ kind: 'repeat', name, state: 'warn', summary: `каждый раз добавлялись строки (${r0} → ${r1} → ${r2}) — если повтор не должен создавать дубль, это баг`, head, rows })
        ctx.verdict({ kind: 'repeat', name, state: 'ok', summary: 'повтор прошёл без ошибок сервера', head, rows })
      }),

    /** The fields remembered under a name (before switching an organisation / a kind…). */
    snapshot: (label: string) =>
      step(`Запомнить поля «${label}»`, async () => {
        await ctx.quiet()
        snaps.set(label, fieldsOnly(await ctx.snap()))
      }),
    /** The fields now against the remembered: those that kept their value after the switch — to look at. */
    compareWith: (label: string) =>
      step(`Проверка: сравнить с «${label}»`, async () => {
        const name = `Сравнить с «${label}»`
        const a = snaps.get(label)
        if (!a) return ctx.verdict({ kind: 'compare', name, state: 'fail', summary: `нет запомненного «${label}» — оно должно быть раньше в сценарии (qa.snapshot)` })
        await ctx.quiet()
        const b = fieldsOnly(await ctx.snap())
        const kept = Object.keys(b).filter((k) => k in a && a[k] && a[k] === b[k])
        const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k])
        const rows = [...kept.map((k) => [k, a[k], b[k], 'осталось']), ...changed.map((k) => [k, a[k] || '—', b[k] || '—', 'сменилось'])].slice(0, 60)
        const head = ['Поле', 'До смены', 'После', '']
        if (kept.length) return ctx.verdict({ kind: 'compare', name, state: 'warn', summary: `после смены остались прежними ${kept.length} ${plural(kept.length, 'поле', 'поля', 'полей')} — проверьте, должны ли они были смениться (значение могло «протечь» из прошлого контекста)`, head, rows })
        ctx.verdict({ kind: 'compare', name, state: 'ok', summary: `после смены ни одно заполненное поле не осталось прежним (сменилось: ${changed.length})`, head, rows })
      }),
  }
}
