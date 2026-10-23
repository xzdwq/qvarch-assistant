<script setup lang="ts">
import { atPoint, openWhile, usePopover } from '../lib/usePopover'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

/**
 * A right click on any picture of the app (a test's screenshot, the layout check's screens, a note's image):
 * «Копировать изображение» — into the Windows clipboard as a picture (a chat, a letter, Paint take it).
 */
const menu = ref<{ x: number; y: number; img: HTMLImageElement }>()
const done = ref('')
function onCtx(e: MouseEvent): void {
  const img = (e.target as Element | null)?.closest?.('img')
  if (!(img instanceof HTMLImageElement) || !img.src || !img.complete || !img.naturalWidth) return
  e.preventDefault()
  e.stopPropagation()
  done.value = ''
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 60), img }
}
/** The picture's bytes as PNG / JPEG (others drawn into a PNG). */
async function bytesOf(img: HTMLImageElement): Promise<Uint8Array> {
  try {
    const blob = await (await fetch(img.src)).blob()
    if (/^image\/(png|jpeg)$/.test(blob.type)) return new Uint8Array(await blob.arrayBuffer())
  } catch {
    // drawn below
  }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  c.getContext('2d')!.drawImage(img, 0, 0)
  const png = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'))
  if (!png) throw new Error('не удалось')
  return new Uint8Array(await png.arrayBuffer())
}
async function copy(): Promise<void> {
  const m = menu.value
  if (!m) return
  try {
    await window.qa.copyImage(await bytesOf(m.img))
    done.value = 'Скопировано'
  } catch (e) {
    done.value = `Не скопировалось: ${e instanceof Error ? e.message : String(e)}`
  }
  setTimeout(() => (menu.value = undefined), 700)
}
// (its point already fitted into the window when opened)
const { panelRef, style } = usePopover(() => menu.value, { place: atPoint }, openWhile(menu))
onMounted(() => window.addEventListener('contextmenu', onCtx, true))
onBeforeUnmount(() => window.removeEventListener('contextmenu', onCtx, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="menu" :ref="panelRef" class="img-menu tw:fixed tw:z-6000 tw:min-w-210 tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="style">
      <button class="tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-30 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" v-if="!done" @click="copy"><Icon name="copy" :size="13" />Копировать изображение</button>
      <span v-else class="done tw:flex tw:items-center tw:gap-8 tw:w-full tw:h-30 tw:py-0 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:text-up-fg"><Icon name="check" :size="13" />{{ done }}</span>
    </div>
  </Teleport>
</template>
