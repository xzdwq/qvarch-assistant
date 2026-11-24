import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where the presets' scripts are written to be run. */
const SCRIPTS_DIR = join(tmpdir(), 'qvarch-preset-scripts')

/**
 * A preset's script as a .ps1 file to run: named by its text (the same text — the same file, written once), in UTF-8
 * with a BOM (Windows PowerShell 5.1 reads a file without one in the ANSI code page and garbles Cyrillic).
 */
export function presetScriptFile(text: string, dir = SCRIPTS_DIR): string {
  const body = text.replace(/^﻿/, '').replace(/\r?\n/g, '\r\n')
  const file = join(dir, `${createHash('sha256').update(body).digest('hex').slice(0, 16)}.ps1`)
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, '﻿' + body, 'utf8')
  }
  return file
}
