import { defineStore } from 'pinia'

interface TabItem {
    path: string
    title: string
    cacheKey: string
    pluginCode?: string
    debugUrl?: string
}

export const useTabsStore = defineStore('tabs', {
    state: () => ({
        tabs: [] as TabItem[],
        activeTab: '',
        // 存储需要被排除缓存的 key（当 tab 关闭时添加到这里）
        excludeKeys: [] as string[],
        // 插件刷新计数器：递增后 frame/index.vue 中 PluginView key 变化触发组件重建
        pluginRefreshKeys: {} as Record<string, number>
    }),

    getters: {
        pluginTabs(): TabItem[] {
            return this.tabs.filter(tab => tab.pluginCode)
        },
        debugTabs(): TabItem[] {
            return this.tabs.filter(tab => tab.debugUrl)
        },
        isPluginActive(): boolean {
            return this.activeTab.startsWith('/plugin/')
        },
        activePluginCode(): string | null {
            const tab = this.tabs.find(t => t.path === this.activeTab)
            return tab?.pluginCode || null
        }
    },

    actions: {
        // 添加标签页
        addTab(tab: TabItem) {
            if (!this.tabs.find(t => t.path === tab.path)) {
                this.tabs.push(tab)
            }
            // 如果这个 key 之前被排除了，现在重新打开，需要移除排除
            const excludeIndex = this.excludeKeys.indexOf(tab.cacheKey)
            if (excludeIndex !== -1) {
                this.excludeKeys.splice(excludeIndex, 1)
            }
            this.activeTab = tab.path
        },

        // 移除标签页及其缓存
        removeTab(targetPath: string): string | null {
            const index = this.tabs.findIndex(tab => tab.path === targetPath)
            if (index !== -1) {
                const removed = this.tabs.splice(index, 1)[0]
                // 将该 cacheKey 添加到排除列表，触发 keep-alive 清除缓存
                if (!this.excludeKeys.includes(removed.cacheKey)) {
                    this.excludeKeys.push(removed.cacheKey)
                }

                // 如果关闭的是当前激活的标签，需要切换到其他标签
                if (this.activeTab === targetPath) {
                    const lastTab = this.tabs[this.tabs.length - 1]
                    this.activeTab = lastTab ? lastTab.path : '/'
                    return this.activeTab
                }
            }
            return null
        },

        /** 移除指定插件的所有标签页 */
        removeTabsByPluginCode(pluginCode: string): string | null {
            const targetPaths = this.tabs
                .filter(tab => tab.pluginCode === pluginCode)
                .map(tab => tab.path)
            let newPath: string | null = null
            targetPaths.forEach(path => {
                newPath = this.removeTab(path) || newPath
            })
            return newPath
        },

        /** 移除所有标签页（含插件、插件中心、设置等），返回新的导航路径 */
        removeAllTabs(): string | null {
            if (!this.tabs.length) return null;
            for (const tab of this.tabs) {
                if (!this.excludeKeys.includes(tab.cacheKey)) {
                    this.excludeKeys.push(tab.cacheKey);
                }
            }
            this.tabs.splice(0, this.tabs.length);
            this.activeTab = '/';
            return '/';
        },

        // 设置当前激活标签
        setActiveTab(path: string) {
            this.activeTab = path
        },

        // 按 path 构造并添加标签页（统一 frame 与 pluginManager 的打开逻辑）
        async addTabByPath(path: string, title: string, opts?: { pluginType?: number; debugUrl?: string }) {
            const router = (await import('@/router')).default
            const resolved = router.resolve(path)
            const routeName = resolved.name as string
            const params = resolved.params as Record<string, any>
            const cacheKey = this.getCacheKey(routeName, params)
            const pluginCode = this.getPluginCode(params)
            this.addTab({
                path,
                title,
                cacheKey,
                pluginCode,
                debugUrl: opts?.pluginType === 1 ? opts?.debugUrl : undefined,
            })
            return path
        },

        // 刷新插件：递增刷新计数器使 frame/index.vue 重建 PluginView 组件
        refreshPlugin(pluginCode: string) {
            const current = this.pluginRefreshKeys[pluginCode] || 0;
            this.pluginRefreshKeys[pluginCode] = current + 1;
        },

        // 根据路由生成缓存 key（需匹配组件的 name 属性）
        getCacheKey(routeName: string | null | undefined, params?: Record<string, any>): string {
            if (routeName === 'plugin' && params?.pluginCode) {
                return `Plugin_${params.pluginCode}`
            }
            const routeToComponentName: Record<string, string> = {
                'setting': 'Setting',
                'pluginManager': 'pluginManager'
            }
            return routeToComponentName[routeName || ''] || routeName || 'default'
        },

        // 获取 pluginCode
        getPluginCode(params?: Record<string, any>): string | undefined {
            if (params?.pluginCode) {
                return Array.isArray(params.pluginCode) ? params.pluginCode[0] : params.pluginCode
            }
            return undefined
        }
    }
})
