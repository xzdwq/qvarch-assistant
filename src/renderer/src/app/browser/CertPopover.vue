<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { openWhile, usePopover, type Placement } from '../../lib/usePopover'
import { useBrowserView } from './browserViewContext'

/** The site's connection (teleported, under the lock): plain http, or its certificate — who, by whom, until when, fingerprints. */
const { cert } = useBrowserView().site
/** Under the lock, from its left edge. */
const underLock: Placement = ({ rect }) => ({ style: { left: `${rect.left}px`, top: `${rect.bottom + 6}px` } })
const { panelRef, style } = usePopover(() => cert.value?.anchor, { place: underLock }, openWhile(cert))
const longDate = (t?: number) => (t ? new Date(t).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
</script>

<template>
  <div v-if="cert" :ref="panelRef" class="certpop tw:fixed tw:z-1400 tw:w-[min(560px,calc(100vw-24px))] tw:max-h-[75vh] tw:overflow-y-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]" :style="style">
    <template v-if="!cert.info.secure">
      <div class="ch bad tw:flex tw:items-center tw:gap-8 tw:mb-6 tw:text-[13.5px] tw:font-semibold tw:text-down-fg"><Icon name="globe" :size="14" />Соединение не защищено</div>
      <p class="tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-text-2">Сайт <b class="">{{ cert.info.host }}</b> открыт по http: всё, что вы вводите (в том числе пароли), передаётся открытым текстом.</p>
    </template>
    <template v-else>
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-6 tw:text-up-fg tw:text-[13.5px] tw:font-semibold tw:[&.bad]:text-down-fg" :class="{ bad: cert.info.ok === false || cert.info.trusted }"><Icon name="lock" :size="14" />{{ cert.info.trusted ? 'Сертификат не доверенный — открыт по вашему решению' : cert.info.ok === false ? 'Сертификат не прошёл проверку' : 'Соединение защищено' }}</div>
      <template v-if="cert.info.subject">
        <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Кому выдан</div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Общее имя (CN)</span><b class="tw:font-medium tw:text-text">{{ cert.info.subject.CN ?? '—' }}</b></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Организация (O)</span><b class="tw:font-medium tw:text-text">{{ cert.info.subject.O ?? '<не указана>' }}</b></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Подразделение (OU)</span><b class="tw:font-medium tw:text-text">{{ cert.info.subject.OU ?? '<не указано>' }}</b></div>
        <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Кем выдан</div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Общее имя (CN)</span><b class="tw:font-medium tw:text-text">{{ cert.info.issuer?.CN ?? '—' }}</b></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Организация (O)</span><b class="tw:font-medium tw:text-text">{{ cert.info.issuer?.O ?? '<не указана>' }}</b></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Подразделение (OU)</span><b class="tw:font-medium tw:text-text">{{ cert.info.issuer?.OU ?? '<не указано>' }}</b></div>
        <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Срок действия</div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Дата выдачи</span><b class="tw:font-medium tw:text-text">{{ longDate(cert.info.validFrom) }}</b></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Действует до</span><b class="tw:font-medium tw:text-text tw:[&.warn]:text-warn-fg" :class="{ warn: (cert.info.validTo ?? 0) - Date.now() < 14 * 864e5 }">{{ longDate(cert.info.validTo) }}</b></div>
        <template v-if="cert.info.san?.length">
          <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Для адресов</div>
          <div class="csan tw:pl-12 tw:text-text-2 tw:font-data tw:text-[11.5px] tw:wrap-anywhere">{{ cert.info.san.join(', ') }}</div>
        </template>
        <template v-if="cert.info.chain?.length">
          <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Цепочка</div>
          <div class="csan tw:pl-12 tw:text-text-2 tw:font-data tw:text-[11.5px] tw:wrap-anywhere">{{ [cert.info.subject.CN, ...cert.info.chain].join(' ← ') }}</div>
        </template>
        <div class="cs tw:mt-14 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-text-hi tw:font-semibold">Отпечатки SHA-256</div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Сертификат</span><code class="tw:font-data tw:text-[11.5px] tw:wrap-anywhere">{{ cert.info.sha256 }}</code></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Открытый ключ</span><code class="tw:font-data tw:text-[11.5px] tw:wrap-anywhere">{{ cert.info.keySha256 }}</code></div>
        <div class="cr2 tw:grid tw:grid-cols-[170px_minmax(0,1fr)] tw:gap-10 tw:pt-2 tw:pr-0 tw:pb-2 tw:pl-12"><span class="tw:text-text-2">Серийный номер</span><code class="tw:font-data tw:text-[11.5px] tw:wrap-anywhere">{{ cert.info.serial }}</code></div>
      </template>
      <p v-else class="muted tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-text-2">Подробности сертификата появятся после следующего соединения с сайтом (обновите страницу).</p>
      <p v-if="cert.info.result && cert.info.result !== 'net::OK'" class="bad tw:text-down-fg tw:mt-8 tw:mr-0 tw:mb-0 tw:ml-0">{{ cert.info.result }}</p>
    </template>
  </div>
</template>
