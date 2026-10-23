---
paths:
  - "**/*.vue"
  - "**/*.css"
  - "src/renderer/src/lib/cssColor.ts"
  - "scripts/tailwind/**"
  - "scripts/parity/**"
---

# Стили: Tailwind v4 с префиксом `tw:`

- Стили компонентов — утилиты в разметке: `tw:flex tw:gap-6 tw:hover:bg-hover tw:[&.on]:text-accent-fg`. Без префикса — только смысловые классы (маркеры и состояния: `on`, `pill`, `nrow`). Префикс не даёт словам из кода и классам библиотек (терминал, CodeMirror) случайно стать утилитами.
- Токены — из `lib/base.css` и `styles/colors/*`, в Tailwind под теми же именами: `bg-panel`, `text-muted`, `border-border-2`, `rounded-r2`, `font-data`, `bg-stop`. Новый токен для классов — переменная в CSS + строка `--color-x: var(--x)` в `styles/tailwind.css` `@theme inline`. Единица отступов — 1px (`tw:p-8` — 8px).
- Полупрозрачность — модификатором: `tw:bg-white/7`, `tw:bg-accent/22`, `tw:border-down/50`. `rgba(...)` цвета темы в классах не пишется.
- **Цвета — только в CSS.** Темы контраста — `styles/colors/theme.css` (`data-contrast` на корне, TS ставит атрибут); цвета контекстов — `styles/colors/<контекст>.css`, переменные по смыслу (`--kind-task`, `--syntax-keyword`, `--ansi-red`). В коде — `var(--x)`; где нужен настоящий цвет (canvas, терминал, `<input type="color">`, цвет в данных пользователя) — `cssColor` / `cssHex` (`lib/cssColor.ts`), палитры `--x-1…n` — `cssPalette`.
- Тени и прочие повторяющиеся значения — переменные (`--shadow-menu`, `--shadow-pop-edge`…), в классах `tw:[box-shadow:var(--shadow-menu)]`.
- `lib/base.css` — в слое `base` ниже утилит: утилита компонента всегда сильнее базового вида.
- `<style>` внутри `.vue` нет. Что разметка не несёт (`:deep` в чужой DOM: v-html, CodeMirror, терминал; классы, которые ставит код) — в таблице стилей рядом: `<style scoped src="./X.css">`. Переносишь элементы в дочерний компонент — переноси и их правила в его таблицу. Компонент с несколькими корнями (элемент + `<Teleport>`) классы родителя не получает: один корень или `inheritAttrs: false` + `v-bind="$attrs"`.
- Анимации — `styles/animations.css`, имена `<Компонент>-<имя>`.
- Инструменты (`scripts/tailwind/`): `convert.mjs` — CSS компонента в утилиты с учётом каскада; `canonical.mjs` — короткая форма утилит; `colorTokens.mjs` — цвета в токены; `deadRules.mjs` / `deadVariants.mjs` — мёртвые правила и варианты.
- **Сверка вида** (`scripts/parity/`): `run.mjs <папка> [разделы]` — скрытый снимок вычисленных стилей всех экранов (с hover); `diff.mjs <до> <после> --summary [--only …]`. Базу снимать прямо перед сравнением: таймлайн дня, данные релиза и состояние SQL-блока меняются со временем.
