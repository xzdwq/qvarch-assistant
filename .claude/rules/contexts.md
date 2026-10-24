---
paths:
  - "src/**"
---

# Контексты: где что

- **Чистая логика** (без DOM, Vue, Electron) — `src/shared/<контекст>/`; константы и наборы значений — `shared/<контекст>/constants.ts`. Её видят main, renderer и тесты.
- **Экран** — тонкий корень: `provide…` состояния + раскладка частей; части — компоненты и composables в папке рядом (`app/<экран>/`), общее состояние — `…Context.ts` (provide/inject). Элемент шаблона из composable привязывать как `:ref="els.x"` (строковый `ref` vue-tsc считает неиспользуемым).
- **browser:** main — `main/browser.ts` (класс `Browser`) + `main/browser/` (вкладки, CDP, запись, проверки, хранилище); проверки `qa` — `main/runner/qa/` по группам; запись в странице — `preload/recorder/`; модели — `shared/browser/`; экран — `app/browser/`. Цвета, которые рисуются в чужой странице, — `shared/browser/pageMarks.ts` (CSS приложения там нет).
- **release:** `main/release/git/` (git-слой, тексты конфликтов), `core/` (план), `session/` (жизненный цикл сессии); экран — `app/release/`, чистая логика экрана — `shared/releaseView.ts`.
- **tracker:** чистая логика — `shared/tracker/` (`constants.ts`: встроенные виды `BUILTIN_KINDS`, `isKind`); island — `island/` (`islandState.ts` собирает composables, `pill/`, `panel/`); календарь, таймлайн, табель, отчёты, доска дня — `renderer/src/tracker/*`. Цвет вида в настройках — hex или `var(--kind-…)` (виды по умолчанию); где нужен hex — `kindColorHex`.
- **integrations:** настройки — `app/settings/` (реестры разделов и панелей); терминал — `app/terminal/` + `main/terminal/` (встроенные переменные — реестр `BUILTIN_VARS` в `shared/terminal.ts`); HTTP — `app/http/` + `shared/http.ts` (таблицы тел и авторизации); Jira — `main/jira/`; темы — `shared/theme.ts` + `styles/colors/theme.css`.
- **transport** (сервер и чат):
  - протокол и модели — `shared/transport/` (`protocol.ts` — кадры, методы `TransportMethods`, события `TransportEvents`);
  - клиент — `main/transport/` (`client.ts` без Electron, `keys.ts` — ключи, общие с сервером, `transport.ts` — сервис, `chatFiles.ts` — файлы чатов с кэшем `data/chat-files`, `sharedLog.ts` — журнал `data/shared.log`);
  - чат — блоки блокнота `notebook/blocks/chat/` и `chatfeed/` (лента), состояние окна — `renderer/src/lib/chat.ts`, действия (создать, переименовать, добавить человека, ветки) — `lib/chatActions.ts`, файлы — `lib/chatFiles.ts`; настройки — `app/settings/ServerSection.vue` и `ChatSection.vue`;
  - сервер — `server/` (свой `package.json`, модули `server/src/modules/`, тесты `server/tests/` на встроенном PostgreSQL).
- **инструменты:** доска — `components/board/` (реестр инструментов `tools.ts`, жесты, отрисовка) + модель `shared/whiteboard/`; кодировки — `components/tools/codec/`; подпись PDF — `app/pdf/`.
- **Общее:** ошибки из main — `remoteError` (`shared/remoteError.ts`); всплывающие меню — `usePopover` / `<Popover>`; вложенность меню — `shared/popoverLayers.ts`.
