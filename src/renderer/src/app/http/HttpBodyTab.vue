<script setup lang="ts">
/** The request's body: none, JSON (checked, formatted), text with its type, a form. */
import { computed } from 'vue'
import { BODY_MODES, HTTP_BODY_MODES, type HttpRequest } from '@shared/http'
import { jsonBodyError } from '@shared/httpCollection'
import CodeArea from '../../components/CodeArea.vue'
import KvEditor from '../../components/KvEditor.vue'

const props = defineProps<{ req: HttpRequest }>()
const RAW_TYPES = ['text/plain', 'application/xml', 'text/html', 'text/csv', 'application/javascript', 'application/x-yaml']
const jsonError = computed(() => (props.req.body.mode === 'json' ? jsonBodyError(props.req.body.text) : ''))
/** The JSON body pretty-printed (not JSON, or {{vars}} outside strings — left as it is). */
function formatJson(): void {
  const b = props.req.body
  try {
    b.text = JSON.stringify(JSON.parse(b.text), null, 2)
  } catch {
    // left as it is
  }
}
</script>

<template>
        <div class="body tw:flex tw:flex-col tw:gap-8">
          <div class="brow tw:flex tw:items-center tw:gap-8">
            <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
              <button class="tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" v-for="m in HTTP_BODY_MODES" :key="m" :class="{ on: req.body.mode === m }" @click="req.body.mode = m">{{ BODY_MODES[m].label }}</button>
            </span>
            <select v-if="req.body.mode === 'raw'" v-model="req.body.rawType" class="rt tw:h-26 tw:py-0 tw:px-6 tw:text-[12px]" title="Content-Type">
              <option v-for="t in RAW_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <span class="grow tw:flex-1"></span>
            <span v-if="req.body.mode === 'json'" class="jstate tw:text-up-fg tw:text-[11.5px] tw:[&.bad]:text-down-fg" :class="{ bad: jsonError }">{{ jsonError ? `ошибка: ${jsonError}` : 'JSON верный' }}</span>
            <button v-if="req.body.mode === 'json'" class="ghost tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2" @click="formatJson">Форматировать</button>
          </div>
          <CodeArea v-if="BODY_MODES[req.body.mode].isText":key="`${req.id}-${req.body.mode}`" v-model="req.body.text" :lang="req.body.mode === 'json' ? 'json' : 'text'" :min-height="180" />
          <KvEditor v-else-if="req.body.mode !== 'none'" :rows="req.body.rows" key-hint="поле" />
          <p v-else class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">Без тела. Для GET и HEAD тело не отправляется.</p>
        </div>
</template>
