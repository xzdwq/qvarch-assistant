import { ref } from 'vue'

/** Pictures as data URLs: their size, a file read, a JPEG / WebP turned PNG (pdf-lib takes PNG), a drawing recoloured. */

/** A picture's natural size. */
export async function imageSize(url: string): Promise<{ w: number; h: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  return { w: img.naturalWidth, h: img.naturalHeight }
}

/** A file as a data URL. */
export const readDataUrl = (f: File) =>
  new Promise<string>((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsDataURL(f)
  })

/** A picture drawn through a canvas (optionally repainted) and given back as a PNG data URL. */
async function redraw(src: string, paint?: (g: CanvasRenderingContext2D, w: number, h: number) => void): Promise<string> {
  const i = new Image()
  i.src = src
  await i.decode()
  const c = document.createElement('canvas')
  c.width = i.naturalWidth
  c.height = i.naturalHeight
  const g = c.getContext('2d')!
  g.drawImage(i, 0, 0)
  paint?.(g, c.width, c.height)
  return c.toDataURL('image/png')
}

/** Any picture as a PNG data URL. */
export const toPng = (src: string) => redraw(src)

/**
 * Drawings recoloured (their shape in one colour), each made once per colour; `shown` gives a ready one or the
 * original while it is being made.
 */
export function useTints() {
  const tints = ref<Record<string, string>>({})
  const tintKey = (url: string, c: string) => `${c}|${url.length}|${url.slice(-48)}`
  /** The drawing in a colour (made on the first ask). */
  async function tinted(url: string, c: string): Promise<string> {
    const k = tintKey(url, c)
    if (tints.value[k]) return tints.value[k]
    const out = await redraw(url, (g, w, h) => {
      g.globalCompositeOperation = 'source-in'
      g.fillStyle = c
      g.fillRect(0, 0, w, h)
    })
    tints.value = { ...tints.value, [k]: out }
    return out
  }
  /** What to show for a drawing: its tint if made, else the original. */
  const shown = (it: { url: string; tint?: string }) => (it.tint ? (tints.value[tintKey(it.url, it.tint)] ?? it.url) : it.url)
  return { tinted, shown }
}
