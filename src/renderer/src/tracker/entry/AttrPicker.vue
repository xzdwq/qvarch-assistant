<script setup lang="ts">
import { computed, ref } from 'vue'
import { attrChips, chipsTitle, offeredAttrs, type EntryAttrs } from '@shared/tracker/attributes'
import Icon from '../../components/Icon.vue'
import Popover from '../../components/Popover.vue'
import { attrDefs } from '../../lib/attributes'
import AttrFields from './AttrFields.vue'

/**
 * The event's attributes in its card: one small button of the card's row — the set values' letters in their
 * attributes' colours (none — the icon); opened — a value per attribute (AttrFields). Nothing set up — nothing shown.
 */
const attrs = defineModel<EntryAttrs>({ required: true })
defineProps<{ disabled?: boolean }>()
const offered = computed(() => offeredAttrs(attrDefs.value, attrs.value))
const chips = computed(() => attrChips(attrDefs.value, attrs.value))
const open = ref(false)
const btn = ref<HTMLElement>()
</script>

<template>
  <span v-if="offered.length" class="tw:inline-flex tw:flex-none tw:h-26">
    <button ref="btn" class="tw:inline-flex tw:items-center tw:justify-center tw:gap-3 tw:h-26 tw:min-w-26 tw:box-border tw:py-0 tw:px-4 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-muted tw:text-[12px] tw:hover:enabled:not-[&.on]:bg-hover tw:hover:not-[&.on]:border-accent tw:[&.on]:border-accent" :class="{ on: open }" :disabled="disabled" :title="chips.length ? chipsTitle(chips) : 'Атрибуты события'" @click="open = !open">
      <template v-if="chips.length"><i v-for="c in chips" :key="c.id" class="tw:inline-flex tw:items-center tw:h-18 tw:px-4 tw:rounded-r1 tw:not-italic tw:font-data tw:text-[9.5px] tw:font-bold tw:text-text-hi" :style="{ background: c.color }">{{ c.short }}</i></template>
      <Icon v-else name="layers" :size="13" />
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="360" class="tw:fixed tw:z-5000 tw:p-10 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
      <AttrFields v-model="attrs" />
    </Popover>
  </span>
</template>
