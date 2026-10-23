<script setup lang="ts">
import { useBrowserView } from './browserViewContext'

/** A site asks to sign in (its own window — Basic / Windows): the login and the password, or cancelled. */
const { login, loginDone } = useBrowserView().site
</script>

<template>
  <div v-if="login" class="bq-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:justify-center tw:items-start tw:pt-[10vh] tw:bg-black/55">
    <form class="bq tw:flex tw:flex-col tw:gap-10 tw:w-[min(440px,calc(100vw-32px))] tw:max-h-[80vh] tw:overflow-auto tw:pt-14 tw:pr-16 tw:pb-16 tw:pl-16 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[box-shadow:var(--shadow-pop-edge)]" @submit.prevent="loginDone(true)" @keydown.esc="loginDone(false)">
      <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Вход: {{ login.host }}</div>
      <p v-if="login.realm" class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">{{ login.realm }}</p>
      <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Логин<input v-model="login.user" autofocus spellcheck="false" /></label>
      <label class="tqf tw:flex tw:flex-col tw:gap-5 tw:text-text-2 tw:text-[12px]">Пароль<input v-model="login.pass" type="password" /></label>
      <div class="tqb tw:flex tw:gap-8"><button type="submit" class="primary">Войти</button><button type="button" @click="loginDone(false)">Отмена</button></div>
    </form>
  </div>
</template>
