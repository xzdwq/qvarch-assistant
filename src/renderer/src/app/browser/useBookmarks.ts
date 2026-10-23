import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { browserId, toUrl, type Bookmark, type BrowserTab } from '@shared/browser'
import { bookmarkFolders, findBookmark, flatBookmarks, insertBookmark, parentOfBookmark, withoutBookmarks, withTabIcons } from '@shared/browser/bookmarkTree'
import { bookmarks, hostOf, tabs } from '../../lib/browser'

/** A bookmark or a folder being made / changed (the dialog's fields). */
export type BookmarkEdit = { id: string; title: string; url: string; folder: string; isFolder: boolean; icon?: string }

/**
 * The bookmarks: the bar, the star in the address line, a folder's list under its chip (deeper inside it, back with ‹),
 * their menu, the dialog that makes / changes one; the start page's tiles (bookmarks and the most visited).
 */
export function useBookmarks(deps: { active: () => boolean; byId: (id?: string) => BrowserTab | undefined; isBlank: (url?: string) => boolean; openUrl: (url: string, inNew?: boolean) => void }) {
  const { byId, isBlank } = deps
  const findBm = (pred: (b: Bookmark) => boolean) => findBookmark(bookmarks.value, pred)
  const parentOf = (id: string) => parentOfBookmark(bookmarks.value, id)
  const starred = (id?: string) => {
    const u = byId(id)?.url
    return !!u && !isBlank(u) && !!findBm((b) => b.url === u)
  }
  const saveBms = (list: Bookmark[]) => void window.qa.browser('setBookmarks', JSON.parse(JSON.stringify(list)) as Bookmark[])
  /** Bookmark icons that would not load (a globe instead). */
  const badIcon = reactive(new Set<string>())
  const folders = computed(() => bookmarkFolders(bookmarks.value))
  const bmEdit = ref<BookmarkEdit>()
  /** The star: off — removed; on — with folders, asked where to (and its name); else straight to the bar. */
  function toggleStar(id?: string): void {
    const t = byId(id)
    if (!t || isBlank(t.url)) return
    if (findBm((b) => b.url === t.url)) return saveBms(withoutBookmarks(bookmarks.value, (b) => b.url === t.url))
    const title = t.title || hostOf(t.url)
    if (folders.value.length) bmEdit.value = { id: '', title, url: t.url, folder: '', isFolder: false, icon: t.favicon }
    else saveBms([...bookmarks.value, { id: browserId(), title, url: t.url, ...(t.favicon ? { icon: t.favicon } : {}) }])
  }
  // a bookmark without its icon gets it when its page shows one
  watch(tabs, (list) => {
    const next = withTabIcons(bookmarks.value, list)
    if (next) saveBms(next)
  })
  function saveBmEdit(): void {
    const e = bmEdit.value
    if (!e) return
    bmEdit.value = undefined
    const old = e.id ? findBm((b) => b.id === e.id) : undefined
    const item: Bookmark = e.isFolder
      ? { id: e.id || browserId(), title: e.title.trim() || 'Папка', children: old?.children ?? [] }
      : { id: e.id || browserId(), title: e.title.trim() || hostOf(e.url), url: toUrl(e.url), ...(e.icon ? { icon: e.icon } : {}) }
    const list = e.id ? withoutBookmarks(bookmarks.value, (b) => b.id === e.id) : [...bookmarks.value]
    // (a folder never into itself)
    saveBms(insertBookmark(list, e.folder && e.folder !== item.id ? e.folder : undefined, item))
  }

  // ---------- a folder's contents: a list under its chip (going deeper inside it, back with ‹) ----------
  const folderPop = ref<{ id: string; trail: string[] }>()
  /** A bookmark being dragged (its id). */
  const bmDrag = ref<string>()
  /** The chip the list opened from: the list stays by it (BookmarkFolderPopover), closes when it is gone. */
  const folderAnchor = shallowRef<HTMLElement>()
  function openFolder(id: string, anchor?: HTMLElement, deeper = false): void {
    if (!deeper && folderPop.value?.id === id && !bmDrag.value) return void (folderPop.value = undefined)
    if (anchor && !deeper) folderAnchor.value = anchor
    const p = folderPop.value
    folderPop.value = deeper && p ? { ...p, id, trail: [...p.trail, p.id] } : { id, trail: [] }
  }
  function folderBack(): void {
    const p = folderPop.value
    if (p?.trail.length) folderPop.value = { ...p, id: p.trail[p.trail.length - 1], trail: p.trail.slice(0, -1) }
  }
  const popFolder = computed(() => (folderPop.value ? findBm((b) => b.id === folderPop.value!.id) : undefined))

  function openBm(b: Bookmark, e: MouseEvent): void {
    const el = e.currentTarget as HTMLElement | null
    // a folder in a folder's list opens in that list; on the bar — under its chip
    if (b.children) openFolder(b.id, el?.classList?.contains('bmrow') ? undefined : (el ?? undefined), !!el?.classList?.contains('bmrow'))
    else if (b.url) {
      folderPop.value = undefined
      deps.openUrl(b.url, e.ctrlKey || e.metaKey || e.button === 1)
    }
  }
  async function onBmMenu(b: Bookmark | undefined, e: MouseEvent): Promise<void> {
    const items = b
      ? [...(b.url ? [{ id: 'new', label: 'Открыть в новой вкладке' }, { id: '-', label: '' }] : []), { id: 'edit', label: b.children ? 'Переименовать…' : 'Изменить…' }, { id: 'del', label: b.children ? 'Удалить папку' : 'Удалить' }, { id: '-', label: '' }, { id: 'folder', label: 'Новая папка…' }]
      : [{ id: 'folder', label: 'Новая папка…' }]
    const pick = await window.qa.browser('choose', items, e.clientX, e.clientY)
    if (pick && Object.hasOwn(BM_MENU_ACTIONS, pick)) BM_MENU_ACTIONS[pick](b)
  }
  /** The bookmark menu's items: what each does (to the bookmark clicked; none — the bar's empty place). */
  const BM_MENU_ACTIONS: Record<string, (b: Bookmark | undefined) => void> = {
    new: (b) => {
      if (b?.url) deps.openUrl(b.url, true)
    },
    edit: (b) => {
      if (b) bmEdit.value = { id: b.id, title: b.title, url: b.url ?? '', folder: parentOf(b.id)?.id ?? '', isFolder: !!b.children, icon: b.icon }
    },
    del: (b) => {
      // (a folder with something in it — asked first)
      if (b && (!b.children?.length || confirm(`Удалить папку «${b.title}» со всем, что в ней?`))) saveBms(withoutBookmarks(bookmarks.value, (x) => x.id === b.id))
    },
    folder: () => (bmEdit.value = { id: '', title: 'Новая папка', url: '', folder: folderPop.value?.id ?? '', isFolder: true }),
  }

  // ---------- the start page: bookmarks and the most visited ----------
  const popular = ref<Array<{ url: string; title: string }>>([])
  watch(
    () => [deps.active(), tabs.value.some((t) => isBlank(t.url))],
    async () => (popular.value = (await window.qa.browser('suggest', '')).filter((x) => !x.bookmark).slice(0, 12)),
    { immediate: true },
  )
  const flatBms = computed(() => flatBookmarks(bookmarks.value, 24))
  return { findBm, parentOf, starred, saveBms, badIcon, folders, bmEdit, toggleStar, saveBmEdit, folderPop, folderAnchor, bmDrag, openFolder, folderBack, popFolder, openBm, onBmMenu, popular, flatBms }
}
