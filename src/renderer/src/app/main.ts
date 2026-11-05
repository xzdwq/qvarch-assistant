import { createApp } from 'vue'
import '../lib/base.css'
import '../styles/tailwind.css'
import { syncTheme } from '../lib/theme'
import { catchWindowErrors } from '../lib/windowErrors'
import App from './App.vue'

syncTheme()
const app = createApp(App)
catchWindowErrors(app, 'main')
app.mount('#app')
