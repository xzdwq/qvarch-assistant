<script setup lang="ts">
import TermSidePanel from './terminal/TermSidePanel.vue'
import TermAlerts from './terminal/TermAlerts.vue'
import TermPanes from './terminal/TermPanes.vue'
import TermEmptyInsertDialog from './terminal/TermEmptyInsertDialog.vue'
import TermAskDialog from './terminal/TermAskDialog.vue'
import TermPresetDialog from './terminal/TermPresetDialog.vue'
import TermVarDialog from './terminal/TermVarDialog.vue'
import TermWatchDialog from './terminal/TermWatchDialog.vue'
import TermHelpDialog from './terminal/TermHelpDialog.vue'
import { provideTermView } from './terminal/termViewContext'

/**
 * Терминал: shells in tabs (they keep running while other sections are open), one or two panes side by side —
 * each with its own tabs, like the notebook. On the left: presets (commands with `{{ js }}` inserts), one's own
 * variables for them, and the reactions (a word in the output → a notice, the status bar blinks).
 */
const { prefs } = provideTermView()
const { sideW, sideHidden } = prefs
</script>

<template>
  <div class="tv2 tw:grid tw:h-full tw:min-h-0" :style="{ gridTemplateColumns: sideHidden ? 'minmax(0, 1fr)' : `${sideW}px minmax(0, 1fr)` }">
    <!-- presets / variables / reactions -->
    <TermSidePanel v-if="!sideHidden" />

    <section class="tm tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
      <!-- the reactions' notices -->
      <TermAlerts />

      <!-- one or two panes, each with its tabs -->
      <TermPanes />
    </section>

    <Teleport to="body">
      <!-- an insert came out empty -->
      <TermEmptyInsertDialog />
      <!-- a preset's questions -->
      <TermAskDialog />
      <!-- a preset -->
      <TermPresetDialog />
      <!-- a variable -->
      <TermVarDialog />
      <!-- a reaction -->
      <TermWatchDialog />
      <TermHelpDialog />
    </Teleport>
  </div>
</template>
