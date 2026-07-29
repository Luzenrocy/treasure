import { createApp } from "vue";
import App from "@/App.vue";
import 'element-plus/dist/index.css'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import '@/style/common.css'
import pinia from '@/store';
import router from '@/router'
import { initDatabase } from '@/sql/initOrUpgrade';
import { initPluginBridge } from '@/bridge/pluginBridge';

const app = createApp(App)
app.use(ElementPlus)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}
app.use(pinia)
app.use(router)
app.mount('#app')

initPluginBridge();
initDatabase();