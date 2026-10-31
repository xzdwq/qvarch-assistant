import { REPORT_STATES } from './constants'
import { CHECK_EXPECTS } from './report'

/** The harness's tools as the model is told of them (main serves them in a harness turn). */
export const HARNESS_GUIDES_TOOL = {
  name: 'harness_guides_read',
  description: 'Harness: прочитать инструкции из каталога (по их id) — перед планом прочитай те, что подходят задаче.',
  inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
}
export const HARNESS_PLAN_TOOL = {
  name: 'harness_plan',
  description:
    'Harness: дать план работы — шаги, критерии приёмки и инструкции. Критерий с проверкой: path (заметка) и block (имя исполняемого блока: Playwright, HTTP, SQL, код) — приложение само запустит его; step — после какого шага проверять впервые (дальше он проверяется и после следующих шагов, пока не пройдёт; без step — только в финале). Блока ещё нет — создашь на своём шаге. guides — id инструкций, по которым ведёшь работу; checkGuides — по которым будет финальная проверка.',
  inputSchema: {
    type: 'object',
    properties: {
      guides: { type: 'array', items: { type: 'string' }, description: 'Инструкции для работы (id из каталога)' },
      checkGuides: { type: 'array', items: { type: 'string' }, description: 'Инструкции для финальной проверки (id из каталога)' },
      steps: { type: 'array', items: { type: 'string' }, description: 'Шаги по порядку' },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            path: { type: 'string' },
            block: { type: 'string' },
            step: { type: 'number' },
            expect: { type: 'string', enum: [...CHECK_EXPECTS], description: 'complete — тест должен пройти до конца, найденные им дефекты — его результат (тест на поиск дефектов); не дан — проверка должна пройти' },
          },
          required: ['text'],
        },
      },
    },
    required: ['steps', 'criteria'],
  },
}
export const HARNESS_REPORT_TOOL = {
  name: 'harness_report',
  description:
    'Harness: отчёт в конце хода — как идёт работа. continue — продолжаю; check — шаг сделан, запусти проверки; done — всё сделано (будет финальная проверка); help — нужен человек (question). checks — привязать критерий к блоку, который ты написал (если в плане имя было другим или блока не было): [{ criterion, path, block — его name= }]; проверки, что были до начала работы, перепривязать нельзя.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', enum: [...REPORT_STATES] },
      step: { type: 'number', description: 'Номер шага (с 1), над которым работал' },
      note: { type: 'string', description: 'Что сделано, коротко' },
      question: { type: 'string', description: 'Вопрос человеку (state=help)' },
      unmet: { type: 'array', items: { type: 'number' }, description: 'Финальная проверка: номера невыполненных критериев плана (только они возвращают работу)' },
      recheck: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Значения проверок (подписи или сами значения матрицы), результат которых вызывает сомнение: следующая проверка прогонит заново только их, остальные значения с теми же входными данными берутся из прошлого прогона',
      },
      checks: {
        type: 'array',
        items: { type: 'object', properties: { criterion: { type: 'number' }, path: { type: 'string' }, block: { type: 'string' }, expect: { type: 'string', enum: [...CHECK_EXPECTS] } }, required: ['criterion', 'path', 'block'] },
      },
    },
    required: ['state', 'note'],
  },
}
