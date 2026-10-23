import { computed, reactive, ref, watch, type ComputedRef } from 'vue'
import type { BrowserTab, PasswordInfo } from '@shared/browser'
import { hostOf } from '../../lib/browser'

export const originOf = (url?: string) => {
  try {
    return new URL(url ?? '').origin
  } catch {
    return ''
  }
}

/**
 * Saved passwords: the bar's offer to keep a login a page sent, the key in the address line (this site's logins),
 * the dialog of them all — shown one by one, copied, filled into the page's form, deleted; the sites never offered.
 */
export function usePasswords(deps: { byId: (id?: string) => BrowserTab | undefined; curId: ComputedRef<string | undefined> }) {
  const passwords = ref<PasswordInfo[]>([])
  void window.qa.browser('passwords').then((l) => (passwords.value = l))
  /** A page's login sent: keep it? */
  const pwAsk = ref<{ askId: string; origin: string; username: string; update: boolean }>()
  function pwReply(a: 'save' | 'no' | 'never'): void {
    const x = pwAsk.value
    pwAsk.value = undefined
    if (x) void window.qa.browser('pwAnswer', x.askId, a)
  }
  const sitePasswords = (id?: string) => {
    const o = originOf(deps.byId(id)?.url)
    return o ? passwords.value.filter((x) => x.origin === o) : []
  }
  /** The passwords list: '' — all, an origin — that site's. */
  const pwOpen = ref<string>()
  const pwQ = ref('')
  const pwShown = reactive<Record<string, string>>({})
  const pwList = computed(() => {
    const q = pwQ.value.trim().toLowerCase()
    return passwords.value.filter((x) => (!pwOpen.value || x.origin === pwOpen.value) && (!q || `${x.origin} ${x.username}`.toLowerCase().includes(q))).sort((a, b) => a.origin.localeCompare(b.origin))
  })
  const never = ref<string[]>([])
  watch(pwOpen, async (o) => o !== undefined && (never.value = await window.qa.browser('neverList')))
  async function pwToggle(id: string): Promise<void> {
    if (pwShown[id] !== undefined) delete pwShown[id]
    else pwShown[id] = await window.qa.browser('pwReveal', id)
  }
  async function pwCopy(id: string): Promise<void> {
    await navigator.clipboard.writeText(await window.qa.browser('pwReveal', id))
  }
  function pwDel(x: PasswordInfo): void {
    if (confirm(`Удалить сохранённый пароль ${x.username || '(без логина)'} для ${hostOf(x.origin)}?`)) void window.qa.browser('pwDelete', x.id)
  }
  function pwFill(x: PasswordInfo): void {
    const id = deps.curId.value
    if (!id) return
    pwOpen.value = undefined
    void window.qa.browser('pwFill', id, x.id)
  }
  /** A site offered again (out of «never»). */
  function neverRemove(origin: string): void {
    void window.qa.browser('neverRemove', origin)
    never.value = never.value.filter((x) => x !== origin)
  }
  return { passwords, pwAsk, pwReply, sitePasswords, pwOpen, pwQ, pwShown, pwList, never, pwToggle, pwCopy, pwDel, pwFill, neverRemove }
}
