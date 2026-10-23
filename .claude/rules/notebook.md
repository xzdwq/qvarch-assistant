---
paths:
  - "src/notebook/**"
  - "src/renderer/src/app/NotebookView.vue"
  - "src/renderer/src/components/MdEditor.vue"
  - "src/main/vault.ts"
  - "src/main/vault/**"
  - "tests/notebook/**"
---

# Блокнот: где что (`src/notebook`, алиас `@nb`)

- `domain/` — чистый TS: строка ограды (`blockInfo`, `fence`), значения и шаблоны (`values`), циклы (`loop`), поиск блоков по реестру (`findBlocks`, `noteBlocks`), факты заметки.
- `blocks/<kind>/` — один тип блока, вся его суть в одной папке:
  - `spec.ts` — распознавание в Markdown, название, иконка, высота, команды «@»;
  - `model.ts` — разбор и запись (чистые операции блока тоже здесь — их видят тесты);
  - `run.ts` — исполнитель (только у запускаемых);
  - `view.ts` — компонент и его props;
  - `Block*.vue` (+ части и composables рядом).

  Реестры: `blocks/specs.ts` (общий, его использует и main), `engine/runners.ts`, `ui/blockViews.ts`. Полноту каждого проверяет компилятор. Новый блок = одна папка + строка в трёх реестрах.
- `engine/` — выполнение: `RunEnv` → `NoteEnv` / `PassEnv` (значения, публикация, хранение результатов, id остановки), хранилище результатов, циклы, «Выполнить всё», отчёты. Вход для renderer — `@nb/engine`; вызовы main — через `runApi()`, в тестах — заглушка `setRunApi`.
- `commands/` — меню «@»: порядок, поиск, подменю. Команда возвращает эффект (`CommandEffect`), выполняет его редактор.
- `ui/` — `NoteBlockHost`, `useBlockRun`, `useFenceSource`, `RunHead` / `RunView` / `LoopOut`.
- `screen/` — экран заметок: части `NotebookView` (дерево, поиск, панели и вкладки, тело заметки) и их composables; общее состояние — `notebookScreen.ts` (provide/inject).
- `workspace/` — состояние блокнота в renderer: документы и автосохранение, медиа, раскладка панелей, синхронизация с диском (`lib/notebook.ts` только переадресует).
- `editor/` — расширения CodeMirror (`livePreview`, `components`, `loopBands`, `commandMenu`, `dragDrop`, `valueChips`…). `MdEditor.vue` их только собирает. Путь заметки и события расширения получают через фасет `editorHost`, не из props. Цвета подсветки — `styles/colors/notebook.css` (`--syntax-*`, `--editor-*`).
- Таблица — одно ядро (модель, выделение, буфер обмена, экспорт: `lib/grid.ts`, `shared/gridRange.ts`); его используют таблица заметки, результат SQL и вывод цикла.
- Хранилище в main — `main/vault.ts` (класс `Vault`) + `main/vault/` (файлы, метаданные, запуски, медиа, пакеты, наблюдение, поиск).
- Слои проверяет `tests/notebook/blockRegistry.test.ts`: чистые модули импортируют только относительно и без Vue-компонентов.
