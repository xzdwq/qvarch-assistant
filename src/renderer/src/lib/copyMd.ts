import DOMPurify from 'dompurify'
import { marked } from 'marked'

/**
 * Markdown copied both ways at once: formatted (HTML — a chat, Jira, an e-mail keep the bold, the lists, the tables)
 * and as its text (a plain field gets the Markdown itself).
 */
export async function copyMd(md: string): Promise<void> {
  const html = DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true, async: false }) as string)
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })])
  } catch {
    // (no rich clipboard here — the text at least)
    await navigator.clipboard.writeText(md)
  }
}
