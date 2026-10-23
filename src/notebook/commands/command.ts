/**
 * A command of the note's «@» menu (as Notion's «/»): what it is called, how it is found, and what it does — as
 * data (`CommandEffect`), so a command is a pure function the editor carries out and a test can check.
 */

/** What the editor knows when a command runs (the note, its values, the app's state a command may offer). */
export interface CommandContext {
  /** The query after «@» is typed in Latin letters (a sub-menu keyword is typed back in the same script). */
  latin: boolean
  /** The note's path in the vault ('' — no note). */
  notePath: string
  /** A block name not taken in this note: base, base2, base3… */
  freeName(base: string): string
  /** The name of the note's newest value that is a list (a query's rows, data) — what a loop / a template goes over. */
  newestListName(): string | undefined
  /** The name of the value the note published last. */
  lastValueName(): string | undefined
  /** The first database connection's name ('' — none yet). */
  firstDbConnection(): string
  /** The site the built-in browser talked to last ('https://' — none). */
  currentSiteUrl(): string
  now(): Date
  /** A short random id (a new component's own id). */
  newId(): string
}

/** What a command does, carried out by the editor. */
export type CommandEffect =
  /** A component on lines of its own where «@» was; its first field takes the focus. */
  | { kind: 'insertBlock'; markdown: string }
  /** «@…» replaced by a text; `keepMenu` — the menu stays open (a sub-menu: emoji, a table's size, boards); `complete` — the completion list opens (a code fence's languages). */
  | { kind: 'insertText'; text: string; keepMenu?: boolean; complete?: boolean }
  /** «@…» removed and the app asked to do something (record a voice note, pick a picture). */
  | { kind: 'request'; action: 'record' | 'pickImage' }

/** A command typed together with what it is about («@get https://…», «@select * from t»): inserted with it filled in. */
export interface CommandWithArg {
  /** The whole query after «@» (its groups — what the command takes). */
  pattern: RegExp
  /** The menu's line for it: what will be inserted. */
  title(m: RegExpExecArray): string
  run(ctx: CommandContext, m: RegExpExecArray): CommandEffect
}

export interface NoteCommand {
  id: string
  title: string
  hint: string
  /** An icon name of the Icon component. */
  icon: string
  /** Words it is found by (Russian and English, synonyms — «curl», «get» for HTTP): a whole word first, then a word's start, then a part. */
  keys: string[]
  run(ctx: CommandContext): CommandEffect
  /** Typed with its argument — offered first, filled in. */
  withArg?: CommandWithArg
}
