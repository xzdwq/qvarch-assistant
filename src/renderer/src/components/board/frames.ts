/**
 * The board's repaints, at most one per frame: the whole board (with the live layer and the minimap), or only the
 * live layer (the stroke being drawn — the board under it stays as it is).
 */
export class FrameScheduler {
  private raf = 0
  private liveRaf = 0

  constructor(
    private readonly paintAll: () => void,
    private readonly paintLiveLayer: () => void,
  ) {}

  /** The whole board at the next frame. */
  schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render())
  }

  /** Only the live layer at the next frame (a whole repaint pending covers it). */
  scheduleLive(): void {
    if (this.raf || this.liveRaf) return
    this.liveRaf = requestAnimationFrame(() => {
      this.liveRaf = 0
      this.paintLiveLayer()
    })
  }

  /** The whole board now. */
  render(): void {
    this.raf = 0
    this.paintAll()
  }

  /** Only the live layer now (the pointer moved: its size circle, a frame being dragged). */
  paintLive(): void {
    this.paintLiveLayer()
  }

  /** The pending whole repaint dropped (the board goes away). */
  cancel(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
  }
}
