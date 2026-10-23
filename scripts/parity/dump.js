// Runs in the app's page (injected by the parity steps): the computed styles of every element under a root, by its
// structural path (tag + index among its parent's children — classes are what changes when styles move to Tailwind,
// the markup's structure is not). A pseudo-element with content is dumped too.
;(() => {
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'color', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'text-decoration-color',
    'text-overflow', 'white-space', 'word-break', 'overflow-x', 'overflow-y',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'align-content', 'justify-content', 'justify-items', 'order',
    'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
    'cursor', 'pointer-events', 'visibility', 'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'transform', 'transform-origin',
    'vertical-align', 'user-select', 'contain', 'fill', 'stroke', 'stroke-width', 'filter', 'backdrop-filter', 'list-style-type', 'table-layout', 'border-collapse',
    'object-fit', 'resize', 'scrollbar-width', 'caret-color', 'accent-color', 'appearance', 'isolation', 'mix-blend-mode', 'clip-path', 'text-shadow', 'tab-size',
  ]
  const styleOf = (cs) => PROPS.map((p) => cs.getPropertyValue(p)).join('|')
  /** The dump of an element and its subtree, paths below `path` (its classes into `classes`, when given). */
  function dumpTree(el, path, out, classes) {
    if (classes && el.getAttribute('class')) classes[path] = el.getAttribute('class')
    const cs = getComputedStyle(el)
    if (cs.display === 'none') {
      out[path] = 'display:none'
      return
    }
    const r = el.getBoundingClientRect()
    out[path] = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}|${styleOf(cs)}`
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(el, pe)
      if (ps.content && ps.content !== 'none' && ps.content !== 'normal') out[`${path}${pe}`] = `${ps.content}|${styleOf(ps)}`
    }
    let i = 0
    for (const c of el.children) dumpTree(c, `${path}/${c.tagName.toLowerCase()}${i++}`, out, classes)
  }
  /** The whole page (body down); `__classes` — each element's classes (to tell what a path is). */
  function dump() {
    const out = { __props: PROPS.join('|'), __classes: {} }
    dumpTree(document.body, 'body', out, out.__classes)
    return out
  }
  /** The i-th element matching a selector, with its subtree (a hover state). */
  function dumpOf(selector, i) {
    const el = document.querySelectorAll(selector)[i]
    if (!el) return { __missing: `${selector}[${i}]` }
    const out = {}
    // its path from the body, so the before / after dumps line up
    const parts = []
    for (let e = el; e && e !== document.body; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}${[...e.parentElement.children].indexOf(e)}`)
    dumpTree(el, ['body', ...parts].join('/'), out)
    return out
  }
  window.__parity = { dump, dumpOf, props: PROPS }
})()
