import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import pluginManager from "@/components/pluginManager/index.vue"
import welcome from '@/components/welcome/index.vue'
import Setting from '@/components/setting/index.vue'

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "",
    component: welcome
  },
  {
    path: '/pluginManager',
    name: 'pluginManager',
    component: pluginManager
  },
  {
    path: '/setting',
    name: 'setting',
    component: Setting
  },
  {
    // Plugin 路由 - 实际渲染由 frame 组件的 v-show 处理
    path: '/plugin/:pluginCode',
    name: 'plugin',
    // 使用空组件，实际内容由 frame 中的 PluginView 渲染
    component: { template: '<div></div>' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes: routes,
})

export default router
