<script setup lang="ts">
/** Settings · the AI assistants (MCP): its own component, made to look as the other sections. */
import McpSettings from '../../components/McpSettings.vue'
</script>

<template>
    <section class="tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-14 tw:px-18">
      <h3 class="tw:mt-0 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">AI-ассистенты (MCP)</h3>
      <McpSettings class="mcpw" />
    </section>
</template>

<style scoped src="./AiSection.css"></style>
