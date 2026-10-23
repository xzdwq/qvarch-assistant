---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/shared/ipc/**"
  - "src/shared/api.ts"
  - "tests/ipc/**"
  - "tests/main/**"
---

# Main и IPC: где что

- **Контракт** — `src/shared/ipc/routes.ts` (`QA_ROUTES`): одна запись на метод `window.qa`. Вид канала выводится из типа метода в `QaApi` (`src/shared/api.ts`):
  - возвращает `Promise` — запрос с ответом (`invoke`);
  - принимает обработчик и возвращает отписку — событие;
  - остальное — сообщение без ответа (`send`).

  Новый метод: тип в `QaApi` + строка в `QA_ROUTES`. Мост preload строится по контракту сам; полноту проверяют компилятор и `tests/ipc/routes.test.ts`. Каналы руками не пишутся.
- **Обработчики** — `src/main/ipc/<область>Ipc.ts`, через `handle` / `listen` / `emit` / `handleDispatch` из `src/main/ipc/router.ts`.
- **Точка сборки** — `src/main/index.ts`: создаёт сервисы, регистрирует IPC, жизненный цикл; больше ничего. Общие сервисы и окна — `AppContext` (`src/main/app/appContext.ts`), окна и трей — `AppWindows`.
- **Процессы-исполнители** (код, циклы, Playwright, SQL) — только через `ProcessSupervisor` (`src/main/process/processSupervisor.ts`): старт, стоп с тайм-аутом, окно-владелец, защита от событий устаревшего процесса.
- Обращение к уничтоженному окну падает: `webContents` брать через `contentsOf(w)`. Путь к файлам сборки — `ctx.mainDir`, не `__dirname` (модуль может оказаться в другом чанке).
- В main нет CSS: его цвета (фон окон, страницы входа, Excel) — константы в одном месте (`shared/theme.ts` `WINDOW_FRAME`, `main/signInPage.ts`), не копии.
- Зависимости main и preload не входят в бандл (`build.externalizeDeps` electron-vite включён по умолчанию).
