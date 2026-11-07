# Блок оболочки, галочка «в Выполнить всё», доверие к скриптам — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** блок блокнота выполняет PowerShell / cmd / bash локально или на сервере по сохранённой SSH-сессии, отдаёт вывод значением заметки; любой запускаемый блок можно исключить из пакетных прогонов; чужие и изменённые ИИ скрипты требуют одобрения.

**Architecture:** чистая логика (языки оболочек и способ запуска, сбор вывода, отпечаток и решение о доверии, флаг `skip`) — в `src/shared/shell/` и `src/notebook/domain/`. Локальный запуск — `ProcessSupervisor` + `shellWorker` (процесс сам запускает оболочку и убивает дерево по «Стоп»); по SSH — канал `exec` существующего соединения (`SshConnections`). Блок — папка `blocks/shell/` + строки в трёх реестрах; одобрение — одна точка в его раннере, вопрос — общий диалог окна.

**Tech Stack:** Electron 44, Vue 3, TypeScript, ssh2 1.17, vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-notebook-automation-design.md` (этап 1), SSH-слой — `docs/superpowers/specs/2026-11-07-ssh-terminal-design.md`.

## Global Constraints

- Наборы значений — `as const` в модуле констант, тип выводится из него; реестры вместо `if/else` по типу.
- Чистая логика — в `src/shared` / `@nb/domain`, относительные импорты, тесты vitest в той же задаче.
- Процессы-исполнители — только через `ProcessSupervisor`.
- Файл ≤ ~400 строк; комментарии короткие, на английском.
- Без названий проектов, стендов, задач; без демо-данных.
- Не коммитить (правило проекта) — шаги «Commit» этого плана заменены проверкой `npm run typecheck` + `npx vitest run`.
- Блок заметки: `contain: inline-size; min-width: 0`, широкий вывод прокручивается внутри.
- Значение блока: `{ exitCode, ok, stdout, stderr, lines, matches?, truncated?, ms }`; предел — последние 2 МБ на поток.
- Вопрос одобрения в фоне ждёт 10 минут, потом ошибка «не одобрено».

## Review Focus

1. Вывод в cp866 / UTF-16 (кириллица в PowerShell и cmd) — ожидается читаемый UTF-8 в значении. Тест: Task 3 (`launchLocal` добавляет UTF-8 в начало скрипта PowerShell, `chcp 65001` для cmd).
2. «Стоп» во время `ping -t` / `npm run dev` — не остаётся дочерних процессов. Тест: Task 4, проверка вручную по шагу (worker вызывает `taskkill /T /F`).
3. Гигабайт вывода (`Get-ChildItem C:\ -Recurse`) — память не растёт, `truncated: true`. Тест: Task 3 (`OutputCollector` держит хвост 2 МБ).
4. Скрипт изменён ИИ после одобрения — снова спрашивает. Тест: Task 3 (отпечаток меняется при любой правке тела или строки ограды, `ask=` входит в отпечаток).
5. Блок со `skip` внутри цикла и вызов по имени из MCP — в проходах цикла пропускается, по имени выполняется. Тест: Task 1.

---

### Task 1: флаг `skip` в модели и пакетных списках

**Files:**
- Modify: `src/notebook/domain/blockInfo.ts` (`BlockInfo`, `FLAGS`, `infoMd`)
- Modify: `src/notebook/domain/loop.ts` (`parseLoopInfo`, `loopInfoMd` — как `soft`)
- Modify: `src/notebook/engine/runItems.ts` (`runItemsIn`, новый `itemIsSkipped`)
- Modify: место, где `runItemNamed` строит список (найти `runItemNamed` в `src/notebook/engine/`)
- Test: `tests/notebook/skipFlag.test.ts`

**Interfaces:**
- Produces: `BlockInfo.skip?: boolean`; `LoopInfo.skip?: boolean`; `runItemsIn(text: string, loop?: LoopRange, opts?: { withSkipped?: boolean }): RunItem[]`; `itemIsSkipped(x: RunItem): boolean`.

- [ ] **Step 1: тесты**

```ts
it('skip parsed and written back', () => {
  expect(parseInfo('powershell run skip name=x').skip).toBe(true)
  expect(infoMd(parseInfo('js run skip'))).toBe('js run skip')
})
it('a loop marked skip', () => {
  expect(parseLoopInfo('name=l skip').skip).toBe(true)
  expect(loopInfoMd({ ...parseLoopInfo('name=l'), skip: true })).toContain('skip')
})
it('batch lists leave skipped blocks and loops out; by name they are found', () => {
  const text = '```js run name=a\n1\n```\n```js run skip name=b\n2\n```\n'
  expect(runItemsIn(text).map(itemName)).toEqual(['a'])
  expect(runItemsIn(text, undefined, { withSkipped: true }).map(itemName)).toEqual(['a', 'b'])
})
it('inside a loop the skipped block is left out of the pass', () => { /* loop with two blocks, one skip → runItemsIn(text, loop) has one */ })
```

- [ ] **Step 2:** `npx vitest run tests/notebook/skipFlag.test.ts` — FAIL.
- [ ] **Step 3:** `['skip', 'skip']` в `FLAGS`; `i.skip ? 'skip' : ''` в `infoMd` сразу после `soft`; `skip` в `parseLoopInfo` / `loopInfoMd` как `soft`; в `runItemsIn` — пропуск блока с `f.info.skip` и цикла с `l.info.skip`, если не `opts.withSkipped`; `runItemNamed` вызывает `runItemsIn(..., { withSkipped: true })`.
- [ ] **Step 4:** отчёт заметки (`src/notebook/engine/reports.ts`) перечисляет пропущенные пакетом блоки строкой `— пропущен (не участвует в «Выполнить всё»)`; тест в том же файле: отчёт заметки со `skip`-блоком содержит эту строку.
- [ ] **Step 5:** тест — PASS; `npx vitest run tests/notebook` — PASS (старые тесты не сломаны).

### Task 2: галочка «в Выполнить всё» у запускаемых блоков и циклов

**Files:**
- Create: `src/notebook/ui/batchToggle.ts`
- Modify: `src/notebook/ui/RunHead.vue` (новый проп)
- Modify: каждый `Block*.vue`, где есть `<RunHead` с `:run=` (code, http, sql, pw, tpl, save, data, loop-head — найти `grep -l "<RunHead" src/notebook/blocks`)
- Modify: заголовок цикла (компонент, который правит `<!-- qa:loop … -->`; найти по `loopInfoMd`)

**Interfaces:**
- Consumes: `BlockInfo.skip`, `LoopInfo.skip` (Task 1); `useFenceSource().patchInfo`.
- Produces: `batchToggle(fence: { info: Ref<BlockInfo>; patchInfo(p: Partial<BlockInfo>): void }): { inBatch: boolean; set(on: boolean): void }` (computed-объект); RunHead prop `batch?: { inBatch: boolean; set(on: boolean): void }`.

- [ ] **Step 1:** RunHead рисует при `batch` иконку-переключатель (иконка `list`, класс `on`, title «В «Выполнить всё»: участвует / пропускается — ручной запуск работает всегда»), рядом со статусом; клик → `batch.set(!batch.inBatch)`. Без подписи (компактность).
- [ ] **Step 2:** в каждом запускаемом блоке `:batch="batchToggle(fence)"`; в заголовке цикла — то же через patch комментария цикла.
- [ ] **Step 3:** пропущенный блок в шапке — приглушён (`opacity-60` на иконке вида), чтобы было видно без открытия.
- [ ] **Step 4:** `npm run typecheck` — без ошибок.

### Task 3: чистая модель оболочки — языки, запуск, вывод, доверие

**Files:**
- Create: `src/shared/shell/shells.ts` — языки и способ запуска
- Create: `src/shared/shell/output.ts` — сбор вывода
- Create: `src/shared/shell/trust.ts` — отпечаток и решение
- Test: `tests/shell/shellModel.test.ts`

**Interfaces:**
- Produces:
  - `SHELL_KINDS = ['powershell', 'cmd', 'bash'] as const`; `ShellKind`; `SHELL_LANGS: Record<string, ShellKind>` = `{ powershell, pwsh, ps1 → 'powershell'; cmd, bat → 'cmd'; bash, sh → 'bash' }`; `shellKindOf(lang: string): ShellKind | undefined`.
  - `valuesPrefix(kind: ShellKind, vars: Record<string, unknown>): string` — строки присваивания `QA_<name>` (строка/число/булево — как есть, прочее — JSON); PowerShell `$env:QA_x = '…'` (одинарные кавычки удваиваются), cmd `set "QA_x=…"`, bash `export QA_x='…'` (`'` → `'\''`). Только имена `/^[A-Za-z_]\w*$/`.
  - `launchLocal(kind: ShellKind, script: string, tools: { pwsh?: string; bash?: string }): { file: string; args: string[]; stdin?: string; tempCmd?: string }` — PowerShell: `file = tools.pwsh ?? 'powershell.exe'`, `args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand', base64(utf16le(UTF8_PRELUDE + script))]`, где `UTF8_PRELUDE = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;'`; cmd: `tempCmd = '@echo off\r\nchcp 65001>nul\r\n' + script`, `file='cmd.exe'`, `args=['/d','/s','/c']` (путь к временному файлу добавляет main); bash: `file = tools.bash` (нет — бросить `Error('bash не найден: установите Git Bash или WSL')`), `args=['-s']`, `stdin = script`.
  - `launchRemote(kind: ShellKind, script: string): { command: string; stdin?: string }` — bash: `{ command: 'bash -s', stdin: script }`; PowerShell (Windows-сервер): `{ command: 'powershell -NoProfile -NonInteractive -EncodedCommand <base64>' }`; cmd: `{ command: 'cmd /d /s /c "<script в одну строку через &>"' }`.
  - `class OutputCollector { constructor(match?: { source: string; flags: string }, maxBytes = 2 * 1024 * 1024); feed(stream: 'out' | 'err', chunk: string): void; result(exitCode: number, ms: number): ShellValue }`; `interface ShellValue { exitCode: number; ok: boolean; stdout: string; stderr: string; lines: string[]; matches?: string[][]; truncated?: boolean; ms: number }`. Строки — по `\n` (без `\r`), незаконченная последняя строка держится до конца; при `match` — в `matches` группы совпавших строк (вся строка, если групп нет), а `lines` — только совпавшие; без `match` — `lines` из хвоста stdout. Строка длиннее 4096 символов обрезается для проверки.
  - `shellFingerprint(notePath: string, infoLine: string, body: string, sha256: (s: string) => string): string` — хеш `notePath + '\n' + infoLine + '\n' + body`, где `infoLine` — `infoMd` без `id=` и `h=`.
  - `SHELL_ASK = ['auto', 'always', 'never'] as const`; `TRUST_VERDICTS = ['run', 'confirm'] as const`; `trustVerdict(ask: ShellAsk, approved: boolean): TrustVerdict` — `always` → confirm; иначе approved → run; иначе confirm.

- [ ] **Step 1: тесты**

```ts
it('languages to shells', () => { expect(shellKindOf('PS1'.toLowerCase())).toBe('powershell'); expect(shellKindOf('bat')).toBe('cmd'); expect(shellKindOf('python')).toBeUndefined() })
it('values as variables of each shell, quoted', () => {
  expect(valuesPrefix('powershell', { path: "C:\\it's" })).toBe("$env:QA_path = 'C:\\it''s'\n")
  expect(valuesPrefix('bash', { n: 5, o: { a: 1 } })).toBe(`export QA_n='5'\nexport QA_o='{"a":1}'\n`)
  expect(valuesPrefix('cmd', { 'bad-name': 1 })).toBe('')
})
it('PowerShell gets UTF-8 output and the script encoded', () => {
  const l = launchLocal('powershell', 'Write-Output "привет"', {})
  expect(l.file).toBe('powershell.exe')
  expect(Buffer.from(l.args.at(-1)!, 'base64').toString('utf16le')).toBe(`${UTF8_PRELUDE}Write-Output "привет"`)
})
it('cmd switches to UTF-8 first; bash reads the script from stdin; no bash — a clear error', () => {
  expect(launchLocal('cmd', 'dir', {}).tempCmd).toBe('@echo off\r\nchcp 65001>nul\r\ndir')
  expect(launchLocal('bash', 'ls', { bash: 'C:\\b.exe' })).toEqual({ file: 'C:\\b.exe', args: ['-s'], stdin: 'ls' })
  expect(() => launchLocal('bash', 'ls', {})).toThrow(/bash не найден/)
})
it('remote: bash via stdin', () => { expect(launchRemote('bash', 'df -h')).toEqual({ command: 'bash -s', stdin: 'df -h' }) })
it('output: lines split across chunks, CRLF, exit code → ok', () => {
  const c = new OutputCollector(); c.feed('out', 'a\r\nb'); c.feed('out', 'c\n'); c.feed('err', 'e\n')
  expect(c.result(0, 5)).toEqual({ exitCode: 0, ok: true, stdout: 'a\r\nbc\n', stderr: 'e\n', lines: ['a', 'bc'], ms: 5 })
  expect(new OutputCollector().result(2, 1).ok).toBe(false)
})
it('match keeps only the matching lines and their groups', () => {
  const c = new OutputCollector({ source: '(\\d+)G\\s+(\\d+)%', flags: '' })
  c.feed('out', 'Filesystem Size Use%\n/dev/sda 40G 85%\n')
  const r = c.result(0, 1)
  expect(r.lines).toEqual(['/dev/sda 40G 85%']); expect(r.matches).toEqual([['40', '85']])
})
it('a flood keeps the last 2 MB and says so', () => {
  const c = new OutputCollector(undefined, 1000); for (let i = 0; i < 100; i++) c.feed('out', 'x'.repeat(99) + '\n')
  const r = c.result(0, 1); expect(r.stdout.length).toBeLessThanOrEqual(1000); expect(r.truncated).toBe(true)
})
it('fingerprint changes with the body, the info line, ask=; not with id=/h=', () => { /* four cases with a fake sha256 = identity */ })
it('trust: always asks; approved runs; else asks', () => {
  expect(trustVerdict('always', true)).toBe('confirm'); expect(trustVerdict('never', true)).toBe('run'); expect(trustVerdict('never', false)).toBe('confirm'); expect(trustVerdict('auto', false)).toBe('confirm')
})
```

- [ ] **Step 2:** `npx vitest run tests/shell` — FAIL.
- [ ] **Step 3:** реализовать три модуля по интерфейсам выше (без Node API: base64 utf16le — через `TextEncoder`-подобную ручную кодировку или `btoa` по байтам; `sha256` передаётся снаружи).
- [ ] **Step 4:** `npx vitest run tests/shell` — PASS.

### Task 4: выполнение в main — локально, по SSH, одобрения

**Files:**
- Create: `src/main/runner/shellWorker.ts` (utility process: запускает оболочку, шлёт куски вывода, по `{type:'stop'}` — `taskkill /T /F /PID`, потом выход)
- Create: `src/main/shell/shellRuns.ts` (класс `ShellRuns`: выбор пути local / ssh, сбор через `OutputCollector`, тайм-аут, стоп)
- Create: `src/main/shell/shellApprovals.ts` (класс `ShellApprovals`: `data/shell-approvals.json`, список отпечатков)
- Modify: `src/main/ssh/sshConnections.ts` — `exec(id: string, command: string, stdin?: string): Promise<ClientChannel>` (`client.exec(command, { pty: false })`)
- Modify: `src/main/ipc/runnersIpc.ts` — регистрация (через `ProcessSupervisor` для локального пути)
- Modify: `src/shared/api.ts`, `src/shared/ipc/routes.ts`, `src/notebook/engine/runApi.ts` (Pick)
- Modify: сборка воркеров (там, где перечислены `codeWorker` / `loopWorker` в `electron.vite.config.ts`)

**Interfaces:**
- Consumes: Task 3 (`launchLocal`, `launchRemote`, `valuesPrefix`, `OutputCollector`, `ShellValue`, `shellFingerprint`); `SshConnections.connect`/`hold`.
- Produces (QaApi):
  - `runShell(runId: string, job: { lang: string; script: string; vars: Record<string, unknown>; cwd?: string; ssh?: string; match?: { source: string; flags: string }; timeoutSec?: number }): Promise<{ ok: boolean; value?: ShellValue; error?: string; ms: number }>`
  - `runShellStop(runId: string): void`
  - `onShellOut(cb: (runId: string, stream: 'out' | 'err', chunk: string) => void): () => void` — живой вывод (пачками раз в 100 мс)
  - `shellTrust(fingerprint: string): Promise<boolean>`; `shellApprove(fingerprint: string): Promise<void>`

- [ ] **Step 1:** `shellWorker`: получает `{ file, args, stdin?, cwd, env }` (env — `windowsShellEnv()` из `main/terminal/windowsEnv.ts`, вызывается в main до старта), `spawn(file, args, { windowsHide: true })`, `stdout/stderr` → `postMessage({ type: 'out', stream, chunk })` (UTF-8 декодер на поток), конец → `{ type: 'end', exitCode }`; `{ type: 'stop' }` → `taskkill /T /F /PID <pid>` (`execFile`, `windowsHide`), затем `process.exit(0)`.
- [ ] **Step 2:** `ShellRuns.run(job, owner, out)`:
  - ненулевой `ssh` → `launchRemote`, канал `exec`, `stdin` пишется и закрывается, `exit(code)` → `result(code)`; тайм-аут/стоп → `ch.signal('KILL')`, `ch.close()`; соединение держится (`hold`) на время выполнения; ошибка «нужен пароль» пробрасывается как есть (окно спросит, как в терминале);
  - иначе → `launchLocal` (`pwsh` — `C:\Program Files\PowerShell\7\pwsh.exe` если есть; `bash` — Git Bash `…\Git\bin\bash.exe`, иначе `bash.exe` из PATH), для cmd — временный файл в папке прогона; `ProcessSupervisor` с `stop: { kind: 'ask', message: { type: 'stop' }, graceMs: 3000 }`, `restart: 'kill'`;
  - скрипт = `valuesPrefix(kind, vars) + script`; совпадения — `OutputCollector` (для SSH — регулярка проверяется в `vm` с тайм-аутом 50 мс на пачку, как в `watchScanner`).
- [ ] **Step 3:** `ShellApprovals`: `has(fp)`, `add(fp)` (до 5000 записей, старые выпадают).
- [ ] **Step 4:** проверка вручную в узле Electron (`ELECTRON_RUN_AS_NODE`) скриптом из scratchpad: локально `Write-Output "привет"` → `stdout` содержит «привет»; `ping -t 127.0.0.1` + стоп через 1 с → в `tasklist` нет `PING.EXE`.
- [ ] **Step 5:** `npm run typecheck` — без ошибок.

### Task 5: блок `shell` в блокноте

**Files:**
- Create: `src/notebook/blocks/shell/spec.ts`, `run.ts`, `view.ts`, `BlockShell.vue`, `BlockShell.css` (если нужен `:deep`)
- Create: `src/notebook/engine/shellApproval.ts` — провайдер вопроса
- Modify: `src/notebook/domain/blockSpec.ts` (`BLOCK_KINDS` + `'shell'`), `src/notebook/domain/blockInfo.ts` (`ValueSource` + `'shell'`; настройки `cwd=`, `ssh=`, `match=`, `ask=` в `SETTINGS` и `infoMd`)
- Modify: `src/notebook/blocks/specs.ts`, `src/notebook/engine/runners.ts`, `src/notebook/ui/blockViews.ts`, `src/notebook/commands/registry.ts` (`MENU_ORDER`: `'shell'` после `'js'`)
- Test: `tests/notebook/shellBlock.test.ts`

**Interfaces:**
- Consumes: Task 1–4.
- Produces: `BlockInfo.cwd?: string; ssh?: string; match?: string; ask?: ShellAsk`; `setShellApprover(fn: (req: { notePath: string; key: string; lang: string; script: string; where: string; why: 'new' | 'always' }) => Promise<'once' | 'always' | 'no'>): void`, `askShellApproval(req): Promise<…>` (без провайдера → `'no'`).

- [ ] **Step 1: тесты** — `parseInfo('powershell run ssh=prod match=/(\\d+)%/ ask=always cwd=C:\\x name=d')` даёт поля; `infoMd` пишет их обратно; `shellSpec.detect` узнаёт `bash run`, но не `bash` без `run`; `match=` не регулярка → поле не задаётся.
- [ ] **Step 2:** FAIL → реализовать spec (`chip: 'shell'`, `serialInLoop: false`, `test: false`, команда «@» id `shell`: «Оболочка — PowerShell / cmd / bash, локально или по SSH», вставляет ```` ```powershell run name=<freeName('out')> ````) → PASS.
- [ ] **Step 3:** раннер `run.ts` (как `codeRunner`): `interpolate` тела значениями (`@nb/domain/values`); отпечаток (`shellFingerprint` с `sha256` через `crypto.subtle` — асинхронно); `trustVerdict(info.ask ?? 'auto', await runApi().shellTrust(fp))`; `confirm` → `askShellApproval` (ждать до 10 минут, затем ошибка «Не одобрено за 10 минут»); `'always'` → `shellApprove(fp)`; `'no'` → ошибка «Запуск не разрешён». Затем `runShell`; публикация `value` под `name`; источник `'shell'`; стоп → `runShellStop(slot)`.
- [ ] **Step 4:** `BlockShell.vue`: шапка `RunHead` (иконка `terminal`, вид «Оболочка», `:batch`), выбор языка — одна кнопка с меню (powershell / cmd / bash), выбор места — «Этот ПК» или сессия SSH (`SuggestInput` по `useSshSessions()` именам; хранится id сессии в `ssh=`); `CodeArea` (`lang` по оболочке); живой вывод (`onShellOut` по слоту) в `<pre>` с прокруткой внутри, после конца — код выхода, `ValueView` значения. Правка кода в `CodeArea` → `shellApprove(отпечаток после правки)` (свои правки одобрены сразу).
- [ ] **Step 5:** `npm run typecheck`, `npx vitest run` — PASS.

### Task 6: диалог одобрения

**Files:**
- Create: `src/notebook/screen/ShellApprovalDialog.vue`
- Modify: корень экрана заметок (`NotebookView.vue`) — смонтировать диалог и `setShellApprover`

**Interfaces:**
- Consumes: `setShellApprover` (Task 5).

- [ ] **Step 1:** диалог-очередь: заголовок «Разрешить запуск скрипта?», заметка и блок, где выполняется (Этот ПК / `user@host`), причина («изменён не вами» / «блок просит спрашивать каждый раз»), скрипт целиком в прокручиваемом `<pre>`; кнопки «Разрешить и запомнить», «Только сейчас», «Отказать»; Esc — «Отказать».
- [ ] **Step 2:** `npm run typecheck`, `npx vitest run` — PASS.
- [ ] **Step 3:** версия в `package.json` +1, `npm run dist`, назвать файл сборки.
