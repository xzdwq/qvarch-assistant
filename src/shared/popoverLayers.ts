/**
 * Popovers over popovers, without the DOM: a popover opened from inside another one is its child — a press inside the
 * child is not «outside» the parent; and the order the open ones were opened in — Esc goes to the last one only.
 * (`T` is what a press lands on: a DOM node in the app.)
 */
export class PopoverLayer<T> {
  private readonly children = new Set<PopoverLayer<T>>()

  /** `own` — the target is in this popover's own panel; `parent` — the popover it was opened from inside of. */
  constructor(
    private readonly own: (target: T) => boolean,
    private readonly parent?: PopoverLayer<T>,
  ) {
    parent?.children.add(this)
  }

  /** The target is in this popover, or in any popover opened from inside it (however deep). */
  holds(target: T): boolean {
    return this.own(target) || [...this.children].some((c) => c.holds(target))
  }

  /** Gone (its component unmounted): no longer part of its parent. */
  detach(): void {
    this.parent?.children.delete(this)
  }
}

/** The popovers open now, in the order they opened (one opened again goes to the top). */
export class PopoverStack<E> {
  private readonly open: E[] = []

  /** Opened: on top of the others. */
  push(e: E): void {
    this.remove(e)
    this.open.push(e)
  }

  /** Closed (or gone). */
  remove(e: E): void {
    const i = this.open.indexOf(e)
    if (i >= 0) this.open.splice(i, 1)
  }

  /** The last one opened — the one Esc is for. */
  top(): E | undefined {
    return this.open[this.open.length - 1]
  }

  get size(): number {
    return this.open.length
  }
}
