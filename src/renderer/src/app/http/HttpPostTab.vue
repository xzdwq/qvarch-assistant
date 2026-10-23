<script setup lang="ts">
/** The script over the answer (its `return` is shown as the result). */
import type { HttpRequest } from '@shared/http'
import CodeArea from '../../components/CodeArea.vue'

defineProps<{ req: HttpRequest }>()
</script>

<template>
        <div class="post tw:flex tw:flex-col tw:gap-8">
          <CodeArea :key="`${req.id}-post`" v-model="req.post" lang="js" :min-height="170" />
          <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">
            <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">res.json()</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">res.body</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">res.status</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">res.header('имя')</code>, <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">res.time</code> · <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">qa.set / qa.get / qa.log</code> · что вернёт
            <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">return</code> — покажется во вкладке «Результат». Например: <code class="tw:py-0 tw:px-4 tw:rounded-r1 tw:bg-panel-3 tw:font-data tw:text-[11.5px] tw:text-accent-fg">return res.json().items.filter(x =&gt; x.price &gt; 10).length</code>
          </p>
        </div>
</template>
