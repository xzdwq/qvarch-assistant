import { createApp } from 'vue'
import '../lib/base.css'
import { syncTheme } from '../lib/theme'
import Island from './Island.vue'

syncTheme()
createApp(Island).mount('#app')
