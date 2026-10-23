<script setup lang="ts">
/** The request's authorization: none, a Bearer token or Basic. */
import { HTTP_AUTH, HTTP_AUTH_TYPES, type HttpRequest } from '@shared/http'

defineProps<{ req: HttpRequest }>()
</script>

<template>
        <div class="auth tw:flex tw:flex-col tw:gap-8">
          <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
            <button v-for="a in HTTP_AUTH_TYPES" :key="a" class="tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: req.auth.type === a }" @click="req.auth.type = a">{{ HTTP_AUTH[a].label }}</button>
          </span>
          <label v-if="req.auth.type === 'bearer'" class="fl tw:flex tw:items-center tw:gap-10 tw:max-w-520 tw:text-text-2 tw:text-[12.5px]">Токен <input class="tw:flex-1 tw:font-data" v-model="req.auth.token" placeholder="{{token}}" spellcheck="false" /></label>
          <template v-if="req.auth.type === 'basic'">
            <label class="fl tw:flex tw:items-center tw:gap-10 tw:max-w-520 tw:text-text-2 tw:text-[12.5px]">Логин <input class="tw:flex-1 tw:font-data" v-model="req.auth.user" spellcheck="false" /></label>
            <label class="fl tw:flex tw:items-center tw:gap-10 tw:max-w-520 tw:text-text-2 tw:text-[12.5px]">Пароль <input class="tw:flex-1 tw:font-data" v-model="req.auth.pass" type="password" spellcheck="false" /></label>
          </template>
          <p class="hint tw:mt-6 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[12px]">Заголовок Authorization добавится сам (если не задан на вкладке «Заголовки»). Токен можно получить запросом «перед запросом» и положить в переменную.</p>
        </div>
</template>
