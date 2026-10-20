import { createApp } from 'vue'
import App from './App.vue'
import request from './api/request'
import router from './router'
import store from './store'

import './assets/main.css'

const app = createApp(App)

app.config.globalProperties.$http = request

app.use(router)
app.use(store)
app.mount('#app')
