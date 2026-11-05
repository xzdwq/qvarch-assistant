import { createApp } from 'vue'
import '../lib/base.css'
import '../styles/tailwind.css'
import { syncTheme } from '../lib/theme'
import { catchWindowErrors } from '../lib/windowErrors'
import Island from './Island.vue'

syncTheme()
const app = createApp(Island)
catchWindowErrors(app, 'island')
app.mount('#app')
