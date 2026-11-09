import { HARNESS_WRAP_UP, REPORT_STATES, REVIEWER_OFF } from './constants'
import { guideCatalog, guidesText, type HarnessGuide } from './guides'
import { checkMet } from './failures'
import { currentStep, type HarnessRun, type TurnMode } from './model'

/**
 * What a harness turn is told: the protocol (the harness's own way of working — fixed: the app reads it), the
 * instructions for the task (the person's: chosen from their catalog in the plan), the note's own rules, where the
 * work stands, what this turn is for.
 */

/** The protocol: the harness's algorithm and how a turn ends (fixed, whatever the instructions say). */
export const HARNESS_PROTOCOL = `## Протокол harness (обязательно)
Ты работаешь в режиме harness: приложение ведёт цикл «план → шаги → проверки (→ финальная проверка, если она включена)» и само вызывает тебя снова. Ход — короткий: сделай одно дело и отчитайся.

### План
- Разберись в задаче: прочитай документ и ссылки, поищи связанное в заметках (notes_search, note_related), посмотри память документа. Задача о проекте на диске — прочитай его правила (CLAUDE.md, AGENTS.md, README) и следуй им.
- Пойми, что это за работа, выбери из каталога инструкции, которые ей подходят (только нужные), прочитай их (harness_guides_read) и строй план по ним.
- План — инструментом harness_plan: steps — шаги (3–8, крупные и проверяемые, в порядке риска), criteria — критерии приёмки (конкретные, проверяемые; у каждого, который можно измерить, — исполняемый блок заметки: path, block = его name=… латиницей, step — после какого шага проверять; критерий про снимки / вёрстку проверяет блок с готовой проверкой layout; без блока — только то, что блоком не измерить: такой критерий проверит лишь финальная проверка, а если её нет — никто), guides — инструкции для работы, checkGuides — для финальной проверки.
- Отдельный шаг «прогнать проверку / тест» не нужен: после шага его проверки запускает приложение, их результат ты получаешь.

### Работа
- Один шаг за ход. Конец каждого хода — инструмент harness_report: state = ${REPORT_STATES.join(' | ')}: continue — продолжаю (вызови меня снова); check — шаг сделан, запусти проверки; done — всё сделано; help — нужен человек (question — вопрос).
- Не жди долгих прогонов внутри хода: закончи шаг и сообщи check. Проверка, которая прошла и не менялась, повторно не запускается; блок, на котором несколько критериев, гоняется один раз. Матрица значений помнит результат каждого значения: при повторном прогоне заново идут только значения, чьи входные данные (код сценария, само значение) изменились. Сомневаешься в каких-то значениях — перечисли их в harness_report recheck: заново прогонятся только они. Не гоняй одну и ту же долгую проверку сам по кругу.
- Приложением управляешь ты сам: заметки, компоненты, запуск блоков, браузер (page_look, browser_open; сценарии Playwright с browser=qvarch in=<имя браузера заметки> идут в отдельной странице с тем же входом — экран не нужен). Не проси человека что-то открыть, показать, нажать или не трогать — он работает параллельно.
- Упала проверка — сначала разберись в причине, потом правь; не повторяй одно и то же исправление.
- help — только когда без человека нельзя: нет доступа или данных, которые можешь дать только он, или нужно решение, которое вправе принять только он.

### Нельзя
- Менять проверки и критерии, чтобы они прошли; проверка неверна — спроси человека (help).
- Выдавать секреты (токены, пароли, cookie).
- Нет инструментов — закончи ответ блоком \`\`\`harness с JSON того же вида ({"steps":[…],"criteria":[…],"guides":[…],"checkGuides":[…]} или {"state":"…","note":"…"}).`

const STEP_MARK = { todo: '○', doing: '◐', done: '✓', failed: '✗' } as const
const minutesLeft = (run: HarnessRun, now: number) => Math.max(0, Math.round(run.limits.minutes - (now - run.startedAt) / 60_000))

/**
 * The plan without a final review: a criterion with no block of its own is checked by no one — said when the plan is
 * made (give it a block) and at the work's end (its data in the report). None — a review there, or every one has a block.
 */
function unchecked(run: HarnessRun, mode: 'plan' | 'work'): string {
  if (run.reviewer !== REVIEWER_OFF) return ''
  if (mode === 'plan') return ' В этом прогоне финальной проверки нет: критерий без блока-проверки не проверит никто — каждому, который можно измерить (снимки, числа, состояние страницы, вывод команды), дай блок (path, block).'
  const ids = run.criteria.filter((c) => !c.check).map((c) => c.id)
  return ids.length ? ` Финальной проверки нет: критерии ${ids.join(', ')} без блока — перед done приведи по каждому данные (результат блока, строку документа); чего нет — так и скажи, не засчитывай.` : ''
}

/** Each kind of turn — what it is for. */
const MODE_TASK: Record<TurnMode, (run: HarnessRun) => string> = {
  plan: (run) =>
    (run.go
      ? 'Этап: ПЛАН — уточнение. Человек нажал «Начать», поменяв инструкции и / или написав замечания (выше). Реши сам: если текущий план им уже соответствует — верни его как есть; если нет — поправь только то, что требуется. Его правки шагов и критериев сохрани. Вызови harness_plan (guides и checkGuides — как выбрал человек) — работа начнётся сразу.'
      : run.pinned
      ? 'Этап: ПЛАН. Человек сам выбрал инструкции (они выше) — строй план по ним, guides и checkGuides дай те же. Вызови harness_plan. Работу не начинай.'
      : 'Этап: ПЛАН. Разберись в задаче, выбери инструкции из каталога и прочитай их (harness_guides_read), потом вызови harness_plan с guides и checkGuides. Работу не начинай.') + unchecked(run, 'plan'),
  work: (run) => {
    const i = currentStep(run)
    return `Этап: РАБОТА. Текущий шаг ${i + 1}: «${run.steps[i]?.title ?? ''}». Сделай его и вызови harness_report (check — шаг готов к проверке; done — всё сделано). Блок, который шаг создал или поменял, запусти (note_run) и прочитай результат до отчёта — кроме блоков-проверок критериев (их запускает harness).${unchecked(run, 'work')}`
  },
  fix: (run) => `Этап: ИСПРАВЛЕНИЕ. Разберись, почему не прошло, и исправь:\n${run.fix ?? ''}\nПотом harness_report state=check (или done).`,
  review: () =>
    'Этап: ФИНАЛЬНАЯ ПРОВЕРКА. Ты — проверяющий, свежим взглядом, по инструкциям проверки выше. Судишь только критерии приёмки плана (они выше, с номерами): выполнен ли каждый, по данным (результаты блоков, документ). Новых требований не добавляй и ничего не запускай заново — результаты уже есть. Все критерии выполнены — harness_report state=done (пожелания — в note, они работу не задерживают). Какой-то не выполнен — state=continue, unmet — номера этих критериев, в note по каждому: что именно не так и что сделать. Работа верна, но сомнителен результат отдельных значений проверки — state=continue, recheck — эти значения (только они прогонятся заново, остальные останутся как были). Вернуть работу можно один раз; дальше решает человек.',
}

/** The instructions a turn is given: the catalog to choose from (the plan), the chosen ones' texts (work, the check). */
export function guidesPart(run: HarnessRun, mode: TurnMode, guides: readonly HarnessGuide[]): string {
  const chosen = mode === 'review' ? (run.guides?.check ?? []) : mode === 'plan' ? (run.pinned ? [...(run.guides?.work ?? []), ...(run.guides?.check ?? [])] : []) : (run.guides?.work ?? [])
  const { text, missing } = guidesText(chosen, guides)
  const catalog = mode === 'plan' && !run.pinned ? guideCatalog(guides) : ''
  return [
    catalog ? `## Каталог инструкций (id — название: для чего)\n${catalog}` : '',
    text ? `## Инструкции ${mode === 'review' ? 'проверки' : 'этой работы'}\n${text}` : '',
    missing.length ? `(Инструкций ${missing.join(', ')} больше нет или они выключены — работай без них.)` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Where the run stands, as the turn reads it (steps, criteria with their checks' results, limits, the person's words). */
export function harnessBrief(run: HarnessRun, mode: TurnMode, now: number): string {
  const steps = run.steps.map((s, i) => `${STEP_MARK[s.state]} ${i + 1}. ${s.title}${s.note ? ` — ${s.note.split('\n')[0].slice(0, 200)}` : ''}`).join('\n')
  const criteria = run.criteria
    .map((c) => {
      const state = !c.check
        ? run.reviewer === REVIEWER_OFF
          ? 'без блока проверки — подтверди данными в отчёте'
          : 'проверит финальная проверка'
        : !c.result
          ? 'не проверялся'
          : c.result.missing
            ? `блока ещё нет — создай его (name=${c.check.block}) или привяжи свой блок: harness_report checks`
            : c.result.ok
              ? 'проходит'
              : checkMet(c)
                ? 'прогнан до конца, найдены дефекты — это результат теста (критерий выполнен)'
                : c.result.findings
                  ? 'проверка нашла дефекты (если цель теста — их поиск, это результат: поставь критерию expect=complete через harness_report checks)'
                  : 'не проходит'
      const when = !c.check ? '' : c.step ? `, с шага ${c.step}` : ', в финале'
      return `${c.id}. ${c.text}${c.check ? ` [${c.check.block} в ${c.check.path}${when}]` : ''} — ${state}`
    })
    .join('\n')
  const left = minutesLeft(run, now)
  const wrap = now - run.startedAt >= run.limits.minutes * 60_000 * HARNESS_WRAP_UP ? ' Время почти вышло: закончи текущий шаг, новый не начинай.' : ''
  return [
    `## Задача harness\nЦель: ${run.goal}`,
    steps ? `Шаги:\n${steps}` : '',
    criteria ? `Критерии приёмки:\n${criteria}` : '',
    `Итерация ${run.iteration - run.iterBase + 1} из ${run.limits.iterations}, осталось ~${left} мин.${wrap}`,
    run.lastNote && mode !== 'review' ? `Твой прошлый отчёт: ${run.lastNote.slice(0, 600)}` : '',
    run.hints.length ? `Человек написал по ходу работы (учти):\n${run.hints.map((h) => `- ${h}`).join('\n')}` : '',
    MODE_TASK[mode](run),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Everything a harness turn is told besides the discussion: the protocol, the instructions, the note's rules, the brief. */
export function harnessSystem(o: { run: HarnessRun; mode: TurnMode; now: number; guides: readonly HarnessGuide[]; docRules?: string }): string {
  return [HARNESS_PROTOCOL, guidesPart(o.run, o.mode, o.guides), o.docRules ? `## Правила этой работы (из документа)\n${o.docRules}` : '', harnessBrief(o.run, o.mode, o.now)].filter(Boolean).join('\n\n')
}

/** The line a harness turn is asked by (in the discussion, where a person's question stands). */
export const HARNESS_ASK: Record<TurnMode, string> = {
  plan: 'Harness: составь план по цели (сводка — в указаниях)',
  work: 'Harness: продолжай работу по плану (сводка — в указаниях)',
  fix: 'Harness: исправь то, что не прошло проверку (сводка — в указаниях)',
  review: 'Harness: финальная проверка критериев (сводка — в указаниях)',
}
