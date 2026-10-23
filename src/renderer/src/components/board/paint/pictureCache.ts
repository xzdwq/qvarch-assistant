import { imageUrl } from '../../../lib/notebook'

/** A picture of the board: loading (no img yet), loaded (img) or gone (failed). */
export interface Picture {
  img?: HTMLImageElement
  failed?: boolean
  ready: Promise<void>
}

/** The board's pictures: each loaded once per run (by its vault path); a load done asks for a repaint. */
export class PictureCache {
  private readonly pics = new Map<string, Picture>()

  constructor(private readonly onLoaded: () => void) {}

  /** The picture of a vault path (its load started on the first ask). */
  get(src: string): Picture {
    const known = this.pics.get(src)
    if (known) return known
    const entry: Picture = { ready: Promise.resolve() }
    entry.ready = imageUrl(src)
      .then(
        (u) =>
          new Promise<void>((res) => {
            const img = new Image()
            img.onload = () => ((entry.img = img), res())
            img.onerror = () => ((entry.failed = true), res())
            img.src = u
          }),
      )
      .catch(() => void (entry.failed = true))
      .then(() => this.onLoaded())
    this.pics.set(src, entry)
    return entry
  }
}
