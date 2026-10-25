<script setup lang="ts">
/** What a message carries: a file of the room (a picture, a document, a note of a notebook) or a block (AttachShotView). */
import { computed } from 'vue'
import { isChatFile, isFileKind, type ChatAttach } from '@shared/transport/chat'
import AttachFileView from './AttachFileView.vue'
import AttachShotView from './AttachShotView.vue'

const props = defineProps<{ a: ChatAttach; room: string }>()
const file = computed(() => (isFileKind(props.a.kind) && isChatFile(props.a.data) ? props.a.data : undefined))
</script>

<template>
  <AttachFileView v-if="file" :file="file" :picture="a.kind === 'image'" :room="room" />
  <AttachShotView v-else :a="a" />
</template>
