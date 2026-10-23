import { ref, watch, type Ref } from 'vue'

/** A JSON value from localStorage; `fallback` when missing, unreadable or storage is unavailable. */
export function readStored<T>(key: string, fallback: T, accept: (v: unknown) => v is T = (v): v is T => v != null): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
    return accept(v) ? v : fallback
  } catch {
    return fallback
  }
}

/** Saves a JSON value; without storage it is just not remembered. */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // not remembered — fine
  }
}

/** A ref kept in localStorage under `key` (written on every change). */
export function storedRef<T>(key: string, initial: T, deep = false): Ref<T> {
  const r = ref(initial) as Ref<T>
  watch(r, (v) => writeStored(key, v), { deep })
  return r
}
