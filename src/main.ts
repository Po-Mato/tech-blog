import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from "./router"; // 추가

// createApp(App).mount('#app')

const app = createApp(App);
app.use(router);
app.mount('#app');
