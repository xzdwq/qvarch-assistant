<script setup lang="ts">
import { computed, ref } from 'vue'
import { exprToGen, genToExpr, GEN_KINDS, sampleOf } from '@shared/gen'

/** How a value is made: a generator picked with its parameters (or a value, or an expression) — an example beside it. */
const props = defineProps<{ expr: string; compact?: boolean }>()
const emit = defineEmits<{ update: [expr: string] }>()
const g = computed(() => exprToGen(props.expr))
const kind = computed(() => GEN_KINDS.find((k) => k.id === g.value.id)!)
const defs = (id: string) => GEN_KINDS.find((k) => k.id === id)!.params.map((p) => p.def)
function setGen(id: string): void {
  const args = id === 'code' ? [props.expr] : g.value.id === 'code' ? defs(id) : id === g.value.id ? g.value.args : defs(id)
  emit('update', genToExpr(id, args))
}
const setArg = (i: number, v: string) => emit('update', genToExpr(g.value.id, g.value.args.map((a, j) => (j === i ? v : a))))
const tick = ref(0)
const sample = computed(() => {
  void tick.value
  const s = sampleOf(props.expr)
  if (s === undefined) return 'вычисляется при создании'
  if (s === '') return '(пусто)'
  return s.length > 40 ? `${s.slice(0, 34)}… (${s.length})` : s
})
</script>

<template>
  <span class="gp" :class="{ compact }">
    <select :value="g.id" title="Чем сделать значение" @change="setGen(($event.target as HTMLSelectElement).value)">
      <option v-for="k in GEN_KINDS" :key="k.id" :value="k.id">{{ k.title }}</option>
    </select>
    <template v-for="(p, j) in kind.params" :key="j">
      <select v-if="p.kind === 'choice'" :value="g.args[j]" :title="p.name" @change="setArg(j, ($event.target as HTMLSelectElement).value)">
        <option v-for="c in p.choices" :key="c[0]" :value="c[0]">{{ c[1] }}</option>
      </select>
      <input v-else-if="p.kind === 'num'" class="num" type="number" :value="g.args[j]" :title="p.name" :placeholder="p.name" @change="setArg(j, ($event.target as HTMLInputElement).value)" />
      <input v-else class="txt" :class="{ code: g.id === 'code' || p.kind === 'json' }" :value="g.args[j]" :title="p.name" :placeholder="p.name" spellcheck="false" @change="setArg(j, ($event.target as HTMLInputElement).value)" />
    </template>
    <span class="smp" title="Пример (щёлкните — другой)" @click="tick++">{{ sample }}</span>
  </span>
</template>

<style scoped>
.gp {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
select,
input {
  height: 24px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.num {
  width: 64px;
}
.txt {
  width: 120px;
}
.txt.code {
  width: 220px;
  font-family: var(--font-data);
}
.smp {
  max-width: 220px;
  overflow: hidden;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
</style>
