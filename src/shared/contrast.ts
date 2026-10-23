/** The theme's contrasts, from the softest (own module: the settings' types and the theme both take it). */
export const CONTRASTS = ['soft', 'normal', 'high'] as const
export type Contrast = (typeof CONTRASTS)[number]
