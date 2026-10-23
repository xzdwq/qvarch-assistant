import { createApp } from 'vue'
import '../lib/base.css'
import '../styles/tailwind.css'
import { syncTheme } from '../lib/theme'
import App from './App.vue'

syncTheme()
createApp(App).mount('#app')
