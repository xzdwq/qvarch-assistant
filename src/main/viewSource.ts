/**
 * «Просмотр кода страницы» — our own (Chromium's view-source does not work in an embedded page: its line wrap
 * goes black). The source is fetched with the site's cookies and drawn as a page: line numbers, HTML coloured,
 * the links of href / src open their own source, «Переносить строки» works.
 */
export const SOURCE_SCHEME = 'qa-source'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Coloured HTML: a token's class wraps each of its lines on its own (a line is a row of the table). */
function paint(src: string, base: string, html: boolean): string[] {
  const out: string[] = []
  const put = (text: string, cls?: string, href?: string) => {
    const parts = text.split('\n')
    parts.forEach((p, i) => {
      if (i) out.push('\n')
      if (!p) return
      const inner = esc(p)
      out.push(href ? `<a class="${cls ?? ''}" href="${esc(href)}">${inner}</a>` : cls ? `<span class="${cls}">${inner}</span>` : inner)
    })
  }
  if (!html) {
    put(src)
    return out.join('').split('\n')
  }
  const re = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[A-Za-z][^\s/>]*|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const tok = m[0]
    if (tok.startsWith('<!--')) put(tok, 'c')
    else if (tok.startsWith('<!')) put(tok, 'd')
    else if (/^<\/?[A-Za-z]/.test(tok)) {
      put(tok, 't')
      // the tag's attributes up to its end
      const attrs = /\s+|([^\s=/>"']+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?|\/?>|[^\s>]/g
      attrs.lastIndex = re.lastIndex
      let a: RegExpExecArray | null
      let last = ''
      while ((a = attrs.exec(src))) {
        const t = a[0]
        if (/^\/?>$/.test(t)) {
          put(t, 't')
          re.lastIndex = attrs.lastIndex
          break
        }
        if (/^\s+$/.test(t)) put(t)
        else if (a[1]) {
          put(a[1], 'an')
          put(a[2], 'p')
          last = a[1].toLowerCase()
          if (a[3]) {
            const raw = a[3].replace(/^["']|["']$/g, '')
            let href: string | undefined
            if (/^(href|src)$/.test(last) && raw && !/^(javascript|data):/i.test(raw)) {
              try {
                href = `${SOURCE_SCHEME}:${new URL(raw, base).href}`
              } catch {
                href = undefined
              }
            }
            put(a[3], 'av', href)
          }
        } else put(t, 'an')
        re.lastIndex = attrs.lastIndex
      }
      if (!a) re.lastIndex = src.length
    } else put(tok)
  }
  return out.join('').split('\n')
}

export async function sourcePage(target: string, fetcher: (url: string) => Promise<Response>): Promise<Response> {
  let text: string
  let type = ''
  try {
    const r = await fetcher(target)
    type = r.headers.get('content-type') ?? ''
    text = await r.text()
  } catch (e) {
    text = `Не удалось получить код: ${e instanceof Error ? e.message : String(e)}`
  }
  if (text.length > 8 * 1024 * 1024) text = `${text.slice(0, 8 * 1024 * 1024)}\n… (обрезано: больше 8 МБ)`
  const html = /html|xml/i.test(type) || /^\s*<(!doctype|html|\?xml)/i.test(text)
  const lines = paint(text, target, html)
  const rows = lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="l">${l || ' '}</td></tr>`).join('')
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>view-source:${esc(target)}</title><style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1117;color:#c9d1d9;font:12.5px/1.55 "Cascadia Mono","JetBrains Mono",Consolas,monospace}
  .bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:16px;padding:6px 14px;background:#161b22;border-bottom:1px solid #30363d;font:12.5px "Segoe UI",sans-serif;color:#adb7c6}
  .bar label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
  .bar span{color:#6e7681}
  table{border-collapse:collapse}
  td.n{position:sticky;left:0;padding:0 12px 0 14px;text-align:right;vertical-align:top;color:#566173;background:#0d1117;user-select:none;border-right:1px solid #21262d}
  td.l{padding:0 14px;white-space:pre;vertical-align:top}
  body.wrap td.l{white-space:pre-wrap;word-break:break-all}
  .t{color:#7ee787}.an{color:#79c0ff}.av{color:#a5d6ff}.p{color:#6e7681}.c{color:#8b949e;font-style:italic}.d{color:#d2a8ff}
  a{text-decoration:none}a:hover{text-decoration:underline}
  </style></head><body><div class="bar"><label><input type="checkbox" id="w">Переносить строки</label><span>${lines.length} строк · ${esc(type || 'text')}</span></div>
  <table>${rows}</table>
  <script>
  const w=document.getElementById('w');
  try{if(localStorage.getItem('qa.src.wrap')==='1'){w.checked=true;document.body.classList.add('wrap')}}catch(e){}
  w.addEventListener('change',()=>{document.body.classList.toggle('wrap',w.checked);try{localStorage.setItem('qa.src.wrap',w.checked?'1':'0')}catch(e){}})
  </script></body></html>`
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
