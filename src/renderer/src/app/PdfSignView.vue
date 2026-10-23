<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import SignaturePad from '../components/SignaturePad.vue'
import { useTints } from './pdf/imageData'
import { usePageGeometry } from './pdf/pageGeometry'
import PlacedSignature from './pdf/PlacedSignature.vue'
import { signedPdf } from './pdf/savePdf'
import SignatureBar from './pdf/SignatureBar.vue'
import SignatureShelf from './pdf/SignatureShelf.vue'
import { usePdfDocument } from './pdf/usePdfDocument'
import { usePlacements } from './pdf/usePlacements'
import { useSignatures } from './pdf/useSignatures'

/**
 * Подпись PDF: open a PDF, make a signature (drawn, typed in a handwriting font or from a picture) once —
 * it is kept — and put it anywhere on any page, as many times as needed (drag it from the panel or click
 * it). A placed one moves (across pages too), resizes, turns, takes a colour and transparency; then the
 * signed copy is saved. Nothing leaves the computer. The parts live in ./pdf.
 */
const signatures = useSignatures()
const pdf = usePdfDocument(() => placements.reset())
const { fileName, pages, zoom, busy, setCanvas, setZoom } = pdf
const scrollEl = ref<HTMLElement>()
const fileIn = ref<HTMLInputElement>()
const tints = useTints()
const placements = usePlacements({
  pages,
  zoom,
  geometry: usePageGeometry(scrollEl),
  makeTint: (url, c) => void tints.tinted(url, c),
  openPdf: (f) => void openFile(f),
  keysBusy: () => signatures.padOpen.value,
})
const { items, selected, sel, pageItems, onDrop } = placements
const { padOpen } = signatures
const hasDoc = computed(() => !!pages.value.length)
const deselect = () => void (selected.value = undefined)
const closePad = () => void (padOpen.value = false)

/** A PDF opened (the file input cleared, to take the same file again). */
async function openFile(f: File | undefined): Promise<void> {
  await pdf.openFile(f)
  if (f && fileIn.value) fileIn.value.value = ''
}

/** The signed copy saved beside where the user picks («… (подписан).pdf»). */
async function save(): Promise<void> {
  const original = pdf.original()
  if (!original) return
  busy.value = 'Сохраняю…'
  try {
    const bytes = await signedPdf(original, items.value, pages.value, (it) => (it.tint ? tints.tinted(it.url, it.tint) : Promise.resolve(it.url)))
    const name = fileName.value.replace(/\.pdf$/i, '') + ' (подписан).pdf'
    const where = await window.qa.pdfSave(bytes, name)
    if (where) busy.value = 'Сохранено'
    setTimeout(() => (busy.value = ''), 1600)
  } catch (e) {
    busy.value = ''
    alert(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
  }
}
</script>

<template>
  <div class="ps tw:flex tw:h-full tw:min-h-0">
    <SignatureShelf :signatures="signatures" :placements="placements" :has-doc="hasDoc" />

    <section class="main tw:flex-1 tw:min-w-0 tw:flex tw:flex-col">
      <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-8 tw:h-44 tw:py-0 tw:px-12 tw:border-b tw:border-b-border tw:whitespace-nowrap">
        <button class="btn tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-[4px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:enabled:bg-white/6 tw:disabled:opacity-45 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" @click="fileIn?.click()"><Icon name="upload" :size="13" />Открыть PDF</button>
        <input ref="fileIn" type="file" accept="application/pdf,.pdf" hidden @change="openFile(($event.target as HTMLInputElement).files?.[0])" />
        <span class="fn tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2 tw:text-[12.5px] tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data" :title="fileName">{{ fileName }}</span>
        <span class="sp tw:flex-1 tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data"></span>
        <span v-if="busy" class="busy tw:text-accent-fg tw:text-[12px] tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data">{{ busy }}</span>
        <template v-if="hasDoc">
          <ZoomChip class="tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-hover:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:hover:text-text" :model-value="zoom * 100" :min="25" :max="400" @update:model-value="(v) => setZoom(v / 100)" />
          <button class="btn pri tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-[4px] tw:text-[12px] tw:hover:enabled:bg-white/6 tw:[&&&]:border-transparent tw:bg-accent tw:text-on-accent tw:disabled:opacity-45 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:hover:text-text" :disabled="!items.length" @click="save"><Icon name="download" :size="13" />Сохранить PDF</button>
        </template>
      </div>
      <div ref="scrollEl" class="pages tw:flex-1 tw:min-h-0 tw:overflow-auto tw:flex tw:flex-col tw:items-center tw:gap-16 tw:pt-58 tw:pr-18 tw:pb-18 tw:pl-18 tw:bg-bg" @pointerdown.self="deselect" @dragover.prevent @drop.prevent="onDrop">
        <div v-if="!hasDoc" class="empty tw:m-auto tw:flex tw:flex-col tw:items-center tw:gap-12 tw:text-muted tw:text-[13px]">
          <Icon name="signature" :size="34" />
          <p>Откройте или перетащите сюда PDF, создайте подпись слева и поставьте её на страницу</p>
          <button class="btn pri tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-11 tw:border tw:border-border tw:rounded-[4px] tw:text-[12px] tw:hover:enabled:bg-white/6 tw:[&&&]:border-transparent tw:bg-accent tw:text-on-accent tw:disabled:opacity-45 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:hover:text-text" @click="fileIn?.click()"><Icon name="upload" :size="13" />Открыть PDF</button>
        </div>
        <div
          v-for="(p, i) in pages"
          :key="i"
          class="pg tw:relative tw:flex-none tw:bg-text-hi tw:[box-shadow:0_6px_24px_rgba(0,0,0,0.5)]"
          :data-page="i + 1"
          :style="{ width: `${p.w * zoom}px`, height: `${p.h * zoom}px` }"
          @pointerdown.self="deselect"
        >
          <canvas class="tw:block" :ref="setCanvas(i + 1)" :style="{ width: `${p.w * zoom}px`, height: `${p.h * zoom}px` }" @pointerdown="deselect"></canvas>
          <PlacedSignature v-for="it in pageItems(i + 1)" :key="it.id" :it="it" :selected="selected === it.id" :zoom="zoom" :src="tints.shown(it)" :placements="placements" />
          <!-- the selected drawing's toolbar: colour, transparency, copy, remove -->
          <SignatureBar v-if="sel && sel.page === i + 1" :sel="sel" :zoom="zoom" :placements="placements" />
          <span class="pn tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:absolute tw:right-8 tw:-bottom-18 tw:text-dim tw:text-[11px]">{{ i + 1 }} / {{ pages.length }}</span>
        </div>
      </div>
    </section>
    <SignaturePad v-if="padOpen" @save="signatures.save" @close="closePad" />
  </div>
</template>

<style scoped src="./PdfSignView.css"></style>
