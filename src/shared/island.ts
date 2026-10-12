/**
 * Island geometry shared by main and renderer.
 * The island window has a fixed size and is transparent + click-through outside the visible content;
 * the content itself morphs (pill ↔ panel) with CSS transitions, so there is no window resizing jank.
 */
export const ISLAND_WINDOW = { width: 800, height: 640 }
export const ISLAND_PILL = { width: 750, height: 70 }
export const ISLAND_PANEL_WIDTH = 750 // same width as the collapsed pill
