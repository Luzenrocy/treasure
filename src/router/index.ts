import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import welcome from '@/components/welcome/index.vue'

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "",
    component: welcome
  },
  {
    path: '/pluginManager',
    name: 'pluginManager',
    component: () => import('@/components/pluginManager/index.vue')
  },
  {
    path: '/setting',
    name: 'setting',
    component: () => import('@/components/setting/index.vue')
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
