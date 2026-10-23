<script setup lang="ts">
import { useCloseOnScroll } from '../lib/floating'
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
useCloseOnScroll(menu, () => (menu.value = undefined), '.img-menu')
const away = (e: Event) => menu.value && !(e.target as Element | null)?.closest?.('.img-menu') && (menu.value = undefined)
const esc = (e: KeyboardEvent) => e.key === 'Escape' && (menu.value = undefined)
onMounted(() => {
  window.addEventListener('contextmenu', onCtx, true)
  window.addEventListener('pointerdown', away, true)
  window.addEventListener('keydown', esc)
})
onBeforeUnmount(() => {
  window.removeEventListener('contextmenu', onCtx, true)
  window.removeEventListener('pointerdown', away, true)
  window.removeEventListener('keydown', esc)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="menu" class="img-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <button v-if="!done" @click="copy"><Icon name="copy" :size="13" />Копировать изображение</button>
      <span v-else class="done"><Icon name="check" :size="13" />{{ done }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.img-menu {
  position: fixed;
  z-index: 6000;
  min-width: 210px;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.img-menu button,
.img-menu .done {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.img-menu button:hover {
  background: var(--hover);
}
.img-menu .done {
  color: var(--up-fg);
}
</style>
