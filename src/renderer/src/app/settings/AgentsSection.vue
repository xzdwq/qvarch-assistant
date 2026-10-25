<script setup lang="ts">
/**
 * Settings · the AI agents: one's own agents (each — a provider, a model, a role); put in a chat by «ИИ» in its head,
 * called there by name. Saved by their own form.
 */
import { ref } from 'vue'
import { AGENT_PROVIDERS } from '@shared/agent/providers'
import { cleanProfile, defaultAgentName, type AgentProfileView } from '@shared/agent/profiles'
import Icon from '../../components/Icon.vue'
import { agentProfiles, loadAgents, removeAgent } from '../../lib/agents'
import { useTransport } from '../../lib/transport'
import AgentProfileForm from './AgentProfileForm.vue'

void loadAgents(true)
const editing = ref<AgentProfileView>()
const owner = () => useTransport().value.name ?? ''
function add(): void {
  const mine = agentProfiles.value.length
  const p = cleanProfile({ name: mine ? `${defaultAgentName(owner())} ${mine + 1}` : defaultAgentName(owner()) }, owner())
  editing.value = { ...p, hasKey: false }
}
async function drop(p: AgentProfileView): Promise<void> {
  if (confirm(`Удалить «${p.name}»? Из чатов он пропадёт, когда вы уберёте его там.`)) await removeAgent(p.id)
}
</script>

<template>
  <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
    <h3 class="tw:mt-0 tw:mb-8 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">ИИ-агенты</h3>
    <p class="tw:mt-0 tw:mb-10 tw:text-muted tw:text-[12px]">Добавьте ИИ в чат кнопкой «ИИ» в его шапке и позовите по имени: @ИИ · Имя. Он видит документ, ссылки и обсуждение, ищет по вашим заметкам и пишет результат в документ.</p>
    <div class="tw:flex tw:flex-col tw:gap-6">
      <template v-for="p in agentProfiles" :key="p.id">
        <AgentProfileForm v-if="editing?.id === p.id" :profile="editing" @done="editing = undefined" />
        <div v-else class="tw:flex tw:items-center tw:gap-8 tw:h-32 tw:px-8 tw:border tw:border-border tw:rounded-r2 tw:whitespace-nowrap">
          <Icon name="sparkles" :size="13" />
          <b class="tw:min-w-0 tw:truncate tw:text-[13px]">{{ p.name }}</b>
          <span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[12px]">{{ AGENT_PROVIDERS[p.provider].title }}{{ p.model ? ` · ${p.model}` : '' }}</span>
          <span v-if="AGENT_PROVIDERS[p.provider].key === 'required' && !p.hasKey" class="tw:text-down-fg tw:text-[12px]">нет ключа</span>
          <span class="tw:flex-1"></span>
          <button class="tw:inline-flex tw:w-26 tw:h-26 tw:p-0 tw:items-center tw:justify-center" title="Изменить" @click="editing = p"><Icon name="pencil" :size="12" /></button>
          <button class="tw:inline-flex tw:w-26 tw:h-26 tw:p-0 tw:items-center tw:justify-center" title="Удалить" @click="drop(p)"><Icon name="trash" :size="12" /></button>
        </div>
      </template>
      <AgentProfileForm v-if="editing && !agentProfiles.some((p) => p.id === editing!.id)" :profile="editing" @done="editing = undefined" />
      <button v-if="!editing" class="tw:self-start tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-12" @click="add"><Icon name="plus" :size="12" />Добавить ИИ</button>
    </div>
  </section>
</template>
