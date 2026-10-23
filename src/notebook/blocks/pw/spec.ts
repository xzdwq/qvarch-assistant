import { emptyFuzz, fuzzLines } from '../../../shared/fuzz'
import { isCodeLang } from '../../domain/blockInfo'
import type { RunnableBlockSpec } from '../../domain/blockSpec'
import { heightPerLine } from '../detectors'

/** A browser scenario (```ts playwright): the installed Edge / Chrome driven in a process of its own. */
export const pwSpec: RunnableBlockSpec<'pw'> = {
  kind: 'pw',
  title: 'Playwright',
  reportTitle: 'Тест',
  detect: { by: 'fence', matches: ({ info }) => isCodeLang(info.lang) && !!info.pw && !info.lib },
  estimateHeight: heightPerLine(180, 20),
  runnable: true,
  rawEditable: true,
  commands: [
    {
      id: 'pw',
      title: 'Playwright',
      hint: 'Сценарий в браузере (Edge / Chrome): шаги, скриншот, трассировка, Allure',
      icon: 'globe',
      keys: ['playwright', 'браузер', 'автотест', 'тест', 'e2e', 'сценарий', 'browser', 'test', 'ui'],
      run: (c) => ({ kind: 'insertBlock', markdown: `\`\`\`ts playwright name=${c.freeName('scenario')}\nawait page.goto('https://example.com')\nawait expect(page).toHaveTitle(/Example/)\nreturn await page.title()\n\`\`\`` }),
    },
    {
      id: 'fuzz',
      title: 'Перебор параметров запроса',
      hint: 'Запрос сайта (поиск, фильтр, выгрузка) с перебором параметров: массивы 0 / 1 / 20 / 21 / 100, пусто, null, длинные строки, числа. Таблица: статус, время, сколько найдено; где ломается',
      icon: 'api',
      keys: ['перебор', 'fuzz', 'фаззинг', 'параметры', 'запрос', 'граница', 'массив', 'фильтр', 'api'],
      // the check in a scenario of its own: the site (the browser's page now), the page's login, the request to choose
      run: (c) => ({ kind: 'insertBlock', markdown: ['```ts playwright name=' + c.freeName('fuzz') + ' session', `await page.goto(${JSON.stringify(c.currentSiteUrl())})`, ...fuzzLines(emptyFuzz()), '```'].join('\n') }),
    },
  ],
}
