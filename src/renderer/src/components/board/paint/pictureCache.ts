import { followImage } from '@nb/workspace/mediaFollow'

/** A picture of the board: loading (no img yet), loaded (img) or not here (failed — until it comes). */
export interface Picture {
  img?: HTMLImageElement
  failed?: boolean
  ready: Promise<void>
}

/**
 * The board's pictures: each loaded once per run (by its vault path); a load done asks for a repaint. One not here
 * (a shared board's, on its way from the server) is drawn as missing and comes in the moment it is here.
 */
export class PictureCache {
  private readonly pics = new Map<string, Picture>()

  constructor(private readonly onLoaded: () => void) {}

  /** The picture of a vault path (its load started on the first ask). */
  get(src: string): Picture {
    const known = this.pics.get(src)
    if (known) return known
    let settle = () => {}
    const entry: Picture = { ready: new Promise<void>((res) => (settle = res)) }
    const done = () => (settle(), this.onLoaded())
    followImage(src, {
      shown: (u) => {
        const img = new Image()
        img.onload = () => ((entry.img = img), (entry.failed = false), done())
        img.onerror = () => ((entry.failed = true), done())
        img.src = u
      },
      missing: () => {
        if (entry.failed) return
        entry.failed = true
        done()
      },
    })
    this.pics.set(src, entry)
    return entry
  }
}
