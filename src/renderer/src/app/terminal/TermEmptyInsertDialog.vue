<script setup lang="ts">
/** A preset's insert came out empty: type it in to finish by hand, run as it is, or cancel. */
import { insertOf as insOf } from '@shared/terminalEdit'
import { useTermView } from './termViewContext'

const { emptyAsk, emptyGo } = useTermView().runner
</script>

<template>
      <div v-if="emptyAsk" class="tq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[12vh] tw:bg-black/55" @mousedown.self="emptyAsk = undefined">
        <div class="tq wide tw:flex tw:flex-col tw:gap-10 tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)] tw:w-[min(620px,calc(100vw-32px))]" tabindex="-1" @keydown.esc="emptyAsk = undefined">
          <div class="cap">{{ emptyAsk.preset.name }} — пустая подстановка</div>
          <p class="etext tw:m-0 tw:text-text-2 tw:text-[12.5px] tw:leading-[1.5]">
            Здесь пусто: <template v-for="(x, i) in emptyAsk.empty" :key="i"><code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11px]">{{ insOf(x) }}</code>{{ i < emptyAsk.empty.length - 1 ? ', ' : '' }}</template>.
            Например, в этой папке нет ветки git или в названии ветки нет ключа задачи.
          </p>
          <div class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Команда получится такой<pre class="epre tw:m-0 tw:py-8 tw:px-10 tw:rounded-r2 tw:bg-bg tw:text-text-hi tw:font-data tw:text-[12.5px] tw:whitespace-pre-wrap">{{ emptyAsk.text || '(пустая строка)' }}</pre></div>
          <div class="tqb tw:flex tw:gap-8">
            <button class="primary" @click="emptyGo(false)">Вписать — допишу сам</button>
            <button @click="emptyGo(true)">Выполнить как есть</button>
            <button @click="emptyAsk = undefined">Отмена</button>
          </div>
        </div>
      </div>
</template>
