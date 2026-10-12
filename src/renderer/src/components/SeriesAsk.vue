<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { seriesQuestion } from '../lib/seriesAsk'
import Icon from './Icon.vue'

/** The "only this one / the whole series" question of a repeated block. */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && seriesQuestion.value) seriesQuestion.value.resolve(null)
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="seriesQuestion" class="sa-back" @pointerdown.self="seriesQuestion.resolve(null)">
      <div class="sa">
        <div class="sa-h"><Icon name="repeat" :size="15" />Повторяющееся событие</div>
        <p>{{ seriesQuestion.action === 'delete' ? 'Удалить только это событие или все события серии?' : 'Применить изменения только к этому событию или ко всем событиям серии?' }}</p>
        <div class="sa-b">
          <button class="primary" @click="seriesQuestion.resolve('one')">Только это</button>
          <button :class="{ danger: seriesQuestion.action === 'delete' }" @click="seriesQuestion.resolve('all')">Все в серии</button>
          <span class="sp"></span>
          <button class="ghost" @click="seriesQuestion.resolve(null)">Отмена</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.sa-back {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 7, 12, 0.45);
}
.sa {
  width: 380px;
  max-width: calc(100vw - 32px);
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1b1e29;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6);
  color: #e5e7eb;
  font-size: 13px;
}
.sa-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #c7d2fe;
}
.sa p {
  margin: 10px 0 14px;
  color: #b8bfd0;
  line-height: 1.45;
}
.sa-b {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sa-b .sp {
  flex: 1;
}
.sa-b button {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12.5px;
}
.sa-b button.danger {
  color: #fca5a5;
}
.sa-b button.ghost {
  background: transparent;
  border-color: transparent;
  color: #8b93a7;
}
</style>
