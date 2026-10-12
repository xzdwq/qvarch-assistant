/** whisper.cpp models offered for local speech-to-text (size and SHA-256 of the files on Hugging Face). */
export const WHISPER_MODELS = [
  { id: 'tiny', label: 'Tiny', bytes: 77_691_713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', note: 'очень быстро, русский слабо' },
  { id: 'base', label: 'Base', bytes: 147_951_465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', note: 'быстро, русский так себе' },
  { id: 'small', label: 'Small', bytes: 487_601_967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', note: 'баланс — рекомендуется' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo (q5)', bytes: 574_041_195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', note: 'почти как Large, компактнее' },
  { id: 'medium', label: 'Medium', bytes: 1_533_763_059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', note: 'точнее, медленнее' },
  { id: 'large-v3-turbo', label: 'Large v3 Turbo', bytes: 1_624_555_275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', note: 'лучшее качество' },
] as const

/** The title a dictated block has until its transcript arrives. */
export const VOICE_PENDING = 'Голосовое описание…'

/** Transcript → block title (first sentence / line, ≤ 80 chars) + the full text as description. */
export function titleFromTranscript(t: string): { label: string; description?: string } {
  const text = t.trim()
  const first = (text.split(/\n|(?<=[.!?])\s/)[0] ?? text).trim()
  const label = first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first
  return { label: label || 'Голосовое описание', description: text.length > label.length ? text : undefined }
}

export type WhisperModelId = (typeof WHISPER_MODELS)[number]['id']

export const isWhisperModel = (v: unknown): v is WhisperModelId => WHISPER_MODELS.some((m) => m.id === v)
