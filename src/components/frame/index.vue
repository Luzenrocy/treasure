<script lang="ts">
import {defineComponent} from "vue";
import menuItem from "@/components/frame/menuItem/index.vue"
import PluginView from "@/components/plugin/index.vue"
import DiamondIcon from "@/assets/diamond.svg?component"
import {useMenuStore} from "@/store/menu";
import {useTabsStore} from "@/store/tabs";
import {useMenuRegistry} from "@/store/menuRegistry";
import {dispatchMenuEvent} from "@/bridge/pluginBridge";
import {MenuItem} from '@/class';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {invoke} from '@tauri-apps/api/core';
import {Menu, Submenu, MenuItem as TauriMenuItem, CheckMenuItem, PredefinedMenuItem} from '@tauri-apps/api/menu';
import { logEvent } from '@/utils/logger';
import type {RouteLocationNormalizedLoaded} from 'vue-router';

/** macOS 默认菜单本地化映射 */
const MENU_LABEL_ALIASES: Record<string, string[]> = {
  'View': ['显示'],
  '显示': ['View'],
  'File': ['文件'],
  '文件': ['File'],
  'Edit': ['编辑'],
  '编辑': ['Edit'],
  'Window': ['窗口'],
  '窗口': ['Window'],
  'Help': ['帮助'],
  '帮助': ['Help'],
  'Close Window': ['关闭窗口'],
  '关闭窗口': ['Close Window'],
  'Toggle Full Screen': ['Enter Full Screen', '切换全屏', '进入全屏'],
  'Enter Full Screen': ['Toggle Full Screen', '切换全屏', '进入全屏'],
};

export default defineComponent({
  name: 'frame',
  components: {menuItem, PluginView, DiamondIcon},
  data() {
    return {
      isCollapse: false,
      menus: [] as MenuItem[],
      menuStore: useMenuStore(),
      tabsStore: useTabsStore(),
      menuRegistry: useMenuRegistry(),
      menuRebuildTimer: null as number | null,
    }
  },
  methods: {
    toggleCollapse() {
      this.isCollapse = !this.isCollapse
    },
    showTrafficLights() {
      invoke('set_traffic_lights_visible', { visible: true }).catch(() => {})
    },
    hideTrafficLights() {
      invoke('set_traffic_lights_visible', { visible: false }).catch(() => {})
    },
    removeTab(targetPath: string) {
      const newPath = this.tabsStore.removeTab(targetPath)
      if (newPath) {
        this.$router.push(newPath)
      }
    },
    onHeaderMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('.el-tabs__item')) { return }
      if (e.button !== 0) { return }
      getCurrentWindow().startDragging()
    },
    async handLink(item: MenuItem){
      const path = item.menuPath
      const title = item.menuName
      const isPlugin = path.startsWith('/plugin/')
      const pluginCode = isPlugin ? path.replace('/plugin/', '') : null
      await logEvent('info', 'sys', 'navigate', { path, pluginCode, action: 'open_tab' });
      await this.tabsStore.addTabByPath(path, title, { pluginType: item.pluginType, debugUrl: item.debugUrl })
      this.$router.push(path)
    },
    handTabClick(target: any){
      let path = target.props.name
      this.tabsStore.setActiveTab(path)
      this.$router.push(path)
    },
    getCacheKey(route: RouteLocationNormalizedLoaded): string {
      return this.tabsStore.getCacheKey(
        route.name as string,
        route.params as Record<string, any>
      )
    },
    async getItemText(item: any): Promise<string | undefined> {
      const val = (item as any).text;
      if (typeof val === 'function') return await val.call(item);
      if (typeof val?.then === 'function') return await val;
      if (typeof val === 'string') return val;
      return undefined;
    },
    async removeItem(parent: any, targetLabels: string[]) {
      const items = await parent.items();
      for (const item of items) {
        const t = await this.getItemText(item);
        if (t && targetLabels.includes(t)) {
          await parent.remove(item);
          return;
        }
      }
    },
    async moveItemToEnd(parent: any, targetLabels: string[]) {
      const items = await parent.items();
      for (const item of items) {
        const t = await this.getItemText(item);
        if (t && targetLabels.includes(t)) {
          await parent.remove(item);
          await parent.append(item);
          return;
        }
      }
    },
    async findSubmenuRecursive(items: any[], targetTexts: string[]): Promise<any | null> {
      for (const item of items) {
        try {
          const t = await this.getItemText(item);
          if (!t) continue;
          if (targetTexts.includes(t)) return item;
          if (typeof item.items === 'function') {
            const children = await item.items();
            if (children && children.length > 0) {
              const found = await this.findSubmenuRecursive(children, targetTexts);
              if (found) return found;
            }
          }
        } catch (_) {}
      }
      return null;
    },
    async rebuildMenu() {
      try {
        const activeCode = this.tabsStore.activePluginCode;
        const regs = activeCode ? this.menuRegistry.getActiveRegistrations() : [];
        const menu = await Menu.default();
        this.menuRegistry.clearHandles();
        const menuItems = await menu.items();
        for (const r of regs) {
          const pluginItems = await Promise.all(r.items.map(async it => {
            const itemId = it.id, menuId = r.menuId;
            const action = () => dispatchMenuEvent(activeCode!, menuId, itemId);
            let handle: TauriMenuItem | CheckMenuItem | PredefinedMenuItem;
            if (it.type === 'check')
              handle = await CheckMenuItem.new({ text: it.label, checked: !!it.checked, accelerator: it.accelerator, action });
            else if (it.type === 'separator' || it.id === '')
              handle = await PredefinedMenuItem.new({ item: 'Separator' });
            else
              handle = await TauriMenuItem.new({ text: it.label, accelerator: it.accelerator, action });
            this.menuRegistry.cacheHandle(activeCode!, menuId, itemId, handle);
            return handle;
          })).then(list => list.filter(Boolean));
          if (pluginItems.length === 0) continue;
          const searchLabels = [r.rootLabel, ...(MENU_LABEL_ALIASES[r.rootLabel] || [])];
          const rootMenu = await this.findSubmenuRecursive(menuItems, searchLabels);
if (r.submenuLabel) {
            const submenu = await Submenu.new({ text: r.submenuLabel, items: pluginItems });
            if (rootMenu) {
              await rootMenu.append(submenu);
            } else {
              const fallback = await Submenu.new({ text: r.rootLabel, items: [submenu] });
              await menu.append(fallback);
            }
          } else {
            if (rootMenu) {
              for (const handle of pluginItems) await rootMenu.append(handle);
            } else {
              const top = await Submenu.new({ text: r.rootLabel, items: pluginItems });
              await menu.append(top);
            }
          }
        }
        // 插件菜单追加到 View 菜单后，将"切换全屏"移到末尾，使插件菜单排在上面
        const viewSearchLabels = ['View', ...(MENU_LABEL_ALIASES['View'] || [])];
        const viewMenu = await this.findSubmenuRecursive(menuItems, viewSearchLabels);
        if (viewMenu) {
          const fullScreenLabels = ['Toggle Full Screen', 'Enter Full Screen', '切换全屏', '进入全屏'];
          await this.moveItemToEnd(viewMenu, fullScreenLabels);
        }
        // 宿主默认菜单：始终在 File 下追加关闭标签菜单
        const fileSearchLabels = ['File', ...(MENU_LABEL_ALIASES['File'] || [])];
        const fileMenu = await this.findSubmenuRecursive(menuItems, fileSearchLabels);
        if (fileMenu) {
          const sep = await PredefinedMenuItem.new({ item: 'Separator' });
          const closeTab = await TauriMenuItem.new({ text: 'Close Current Tab', action: () => this.removeTab(this.tabsStore.activeTab) });
          const closeAll = await TauriMenuItem.new({ text: 'Close All Tabs', action: () => this.closeAllPluginTabs() });
          await fileMenu.append(sep);
          await fileMenu.append(closeTab);
          await fileMenu.append(closeAll);
          // 移除系统预定义 Close Window（自带 ⌘W 快捷键会产生 X 符号），替换为自定义不带 accelerator 的版本
          const closeWindowLabels = ['Close Window', ...(MENU_LABEL_ALIASES['Close Window'] || [])];
          await this.removeItem(fileMenu, closeWindowLabels);
          const closeWindow = await TauriMenuItem.new({ text: 'Close Window', action: () => invoke('close_window') });
          await fileMenu.append(closeWindow);
        }
        await this.applyMenu(menu);
      } catch (e: any) {
        console.warn('rebuildMenu failed:', e);
      }
    },
    async applyMenu(menu: Menu) {
      try {
        const isMac = navigator.userAgent.includes('Mac');
        if (isMac) await menu.setAsAppMenu();
        else await menu.setAsWindowMenu();
      } catch (e) { console.warn('Failed to apply native menu:', e); }
    },
    onPluginTabRemoved(path: string) {
      const removedTab = this.tabsStore.tabs.find(t => t.path === path);
      if (removedTab?.pluginCode) {
        const stillHasTab = this.tabsStore.tabs.some(t => t.pluginCode === removedTab.pluginCode && t.path !== path);
        if (!stillHasTab) {
          this.menuRegistry.unregisterAll(removedTab.pluginCode);
          this.rebuildMenu();
        }
      }
    },
    closeAllPluginTabs() {
      console.log('closeAllPluginTabs called');
      if (!this.tabsStore.tabs.length) return;
      this.menuRegistry.clearAll();
      this.tabsStore.removeAllTabs();
      this.$router.push('/');
    },
  },
  computed: {
    activeMenu() {
      let item = this.menus.find(item => item.menuPath === this.tabsStore.activeTab)
      return item?.menuId || ''
    },
    // 判断当前是否显示 plugin 页面
    isPluginRoute(): boolean {
      return this.tabsStore.isPluginActive
    },
    pluginManagerVisible(): boolean {
      return this.menus.some(item => item.menuPath === '/pluginManager')
    },
    menuScrollbarHeight(): string {
      return this.pluginManagerVisible ? 'calc(100% - 40px - 56px * 2)' : 'calc(100% - 40px - 56px)'
    }
  },
  async mounted() {
    await this.menuStore.fetchMenus()
    window.__TREASURE_HOST__ = true
    if (navigator.userAgent.includes('Mac')) {
      invoke('set_traffic_lights_visible', { visible: false }).catch(() => {})
    }
    try {
      const emptyMenu = await Menu.default();
      await this.applyMenu(emptyMenu);
      await this.rebuildMenu();
    } catch (e) { /* 静默降级 */ }
  },
  watch:{
    'menuStore.menus': {
      handler(newVal) {
        this.menus = newVal;
      },
      deep: true,
      immediate: true
    },
    // 标签页切换时重建菜单：仅活跃插件的菜单项可见
    'tabsStore.activeTab': {
      handler() {
        if (this.menuRebuildTimer) clearTimeout(this.menuRebuildTimer);
        this.menuRebuildTimer = window.setTimeout(() => this.rebuildMenu(), 50);
      },
    },
    // 标签关闭时清理该插件菜单注册
    'tabsStore.tabs': {
      handler(newTabs: any[], oldTabs: any[]) {
        if (oldTabs && newTabs.length < oldTabs.length) {
          const removed = oldTabs.find((t: any) => !newTabs.some((n: any) => n.path === t.path));
          if (removed) this.onPluginTabRemoved(removed.path);
        }
      },
      deep: true,
    },
    // 插件注册/注销菜单时触发重建（通过 menuVersion 计数器变更）
    'menuRegistry.menuVersion': {
      handler() {
        this.rebuildMenu();
      },
    },
  }
})
</script>

<template>
  <el-container class="main-container">
    <!-- 左侧侧边栏 -->
    <el-aside
        class="aside-menu"
        :class="{ 'is-collapse': isCollapse }"
    >
      <!-- 导航菜单 -->
      <el-menu
          :default-active="activeMenu"
          class="vertical-menu"
          :collapse="isCollapse"
          :router="true"
          :collapse-transition="false"
      >

        <div class="drag-region" data-tauri-drag-region>
          <div class="brand" @mouseenter="showTrafficLights" @mouseleave="hideTrafficLights">
            <DiamondIcon class="brand-logo" aria-hidden="true"/>
            <span class="brand-text">Treasure</span>
          </div>
        </div>
        <el-scrollbar class="menu-scrollbar" :style="{ height: menuScrollbarHeight }">
          <menu-item v-for="item in menus.filter(item => item.menuPath !== '/setting' && item.menuPath !== '/pluginManager')" :item="item" @handLink="handLink(item)"/>
        </el-scrollbar>
        <menu-item v-for="item in menus.filter(item => item.menuPath === '/pluginManager')" :item="item" @handLink="handLink(item)"/>
        <menu-item v-for="item in menus.filter(item => item.menuPath === '/setting')" :item="item" @handLink="handLink(item)"/>

      </el-menu>
      
      <!-- 侧边栏折叠按钮 -->
      <div class="toggle-button" @click="toggleCollapse">
        <el-icon :size="12">
          <component :is="isCollapse ? 'Expand' : 'Fold'"/>
        </el-icon>
      </div>
    </el-aside>
    <el-container>
      <!-- 顶部标签页 -->
      <el-header height="40px !important" @mousedown="onHeaderMouseDown" @mouseenter="showTrafficLights" @mouseleave="hideTrafficLights">
        <!-- 空白div元素 用以优化页面布局并且实现窗口拖动功能 -->
        <div v-if="tabsStore.tabs.length ==0" data-tauri-drag-region
             style="width: 100%;height: 100%;background-color: var(--treasure-background-color)"></div>
        <el-tabs v-else
            v-model="tabsStore.activeTab"
            type="border-card"
            closable
            @tab-remove="removeTab"
            @tab-click="handTabClick"
        >
          <el-tab-pane
              v-for="tab in tabsStore.tabs"
              :key="tab.path"
              :name="tab.path"
              :label="tab.title"
          />
        </el-tabs>
      </el-header>
      <!-- 主内容区域 -->
      <el-main class="main-content">
        <!-- 非 Plugin 页面使用 router-view + keep-alive -->
        <router-view v-slot="{ Component, route }">
          <keep-alive :max="20" :exclude="tabsStore.excludeKeys">
            <component 
              v-if="route.name !== 'plugin'"
              :is="Component" 
              :key="getCacheKey(route)"
            />
          </keep-alive>
        </router-view>
        
        <!-- Plugin 页面使用 v-show 保持所有 iframe 在 DOM 中 -->
        <PluginView
          v-for="tab in tabsStore.pluginTabs"
          :key="tab.pluginCode + '_' + (tabsStore.pluginRefreshKeys[tab.pluginCode!] || 0)"
          v-show="tabsStore.activeTab === tab.path"
          :plugin-code="tab.pluginCode!"
          :debug-url="tab.debugUrl"
        />
      </el-main>
    </el-container>
  </el-container>
</template>

<style lang="scss" scoped>
@import url('https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap');

.main-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;

  .aside-menu {
    background-color: var(--treasure-side-backgroud-color);
    width: 128px;
    transition: width 0.3s ease-in-out;
    position: relative;
    border-right: 1px solid var(--el-border-color-light);
    overflow: visible;
    z-index: 100;

    &.is-collapse {
      width: 76px;

      .brand .brand-text {
        display: none !important;
      }

      .brand .brand-logo {
        margin-left: -12px;
      }
    }

    .vertical-menu {
      border-right: none;
      background-color: inherit;
      height: 100vh;
      width: 100%;
      overflow: hidden;

      display: flex;
      flex-direction: column;
      position: relative;

      .drag-region {
        flex-shrink: 0;
        width: 100%;
        height: 40px;
        cursor: pointer;

        .brand {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          user-select: none;
          overflow: hidden;

          .brand-logo {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--treasure-side-text);
            filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
            transform: translateY(-3px);
          }

          .brand-text {
            font-family: 'Pinyon Script', cursive;
            font-size: 28px;
            font-weight: 400;
            line-height: 1;
            letter-spacing: 0.2px;
            background: linear-gradient(100deg, #fff0bd 0%, #e8bd61 38%, #c99546 66%, #c5a8dc 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            white-space: nowrap;
            opacity: 1;
            transform: translateY(-2px);
            display: inline-block;
            text-shadow: 0 1px 9px rgba(232, 201, 138, 0.12);
          }
        }
      }

      :deep(.el-menu-item),
      :deep(.el-sub-menu__title) {
        color: var(--treasure-side-text);

        &:hover {
          background-color: var(--treasure-side-hover-bg);
        }

        &.is-active {
          background-color: var(--treasure-side-active-bg) !important;
          border-left: 3px solid var(--treasure-side-accent);
          color:  var(--el-color-primary);
        }
      }
    }

    .toggle-button {
      position: absolute;
      top: 20px;
      right: -12px;
      transform: translateY(-50%);
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
background-color: var(--treasure-side-backgroud-color);
      box-shadow: inset 0 0 0 9999px var(--treasure-side-active-bg),
                  0 0 8px 0 rgba(0,0,0,0.1);
      color: var(--el-color-primary);
      border-radius: 50%;
      cursor: pointer;
      opacity: 0;
      transition: all 0.3s;
      z-index: 200;

      &:hover {
        box-shadow: inset 0 0 0 9999px var(--treasure-side-active-bg),
                    0 0 12px 0 rgba(0,0,0,0.15);
      }
      
      .el-icon {
         transform: scale(0.8);
      }
    }

    &:hover .toggle-button {
      opacity: 1;
    }

  }

  :deep(.el-tabs__item) {
    height: 40px;
    line-height: 40px;
    color: var(--treasure-tab-text);
  }

  :deep(.el-tabs--border-card > .el-tabs__header) {
    background-color: var(--treasure-bg-tabs);
    border-bottom: 1px solid var(--treasure-border-color);
  }

  :deep(.el-tabs__item.is-active) {
    color: var(--treasure-tab-text-active);
  }

  :deep(.el-tabs__content) {
    padding: 0;
    display: none; // 隐藏空的 tab-pane 内容区
  }

  .el-header {
    padding: 0;
    height: 40px;
    cursor: pointer;
  }

  .main-content {
    background-color: var(--treasure-background-color);
    padding: 0px;
    height: calc(100vh - 40px);
    min-height: 0;
    overflow: hidden;
  }
}
</style>
<style>
/* 禁用 el-tabs__item 的所有过渡，避免 box-shadow 过渡产生黑色闪烁 */
.el-tabs--border-card > .el-tabs__header .el-tabs__item {
  transition: none !important;
}

.el-tabs--border-card > .el-tabs__header .el-tabs__item.is-active {
  background-color: var(--treasure-background-color);
  border-bottom: 3px solid var(--treasure-tab-accent);
  box-shadow: inset 0 0 0 9999px rgba(232, 201, 138, 0.36);
}
.el-container {
  background-color: var(--treasure-background-color);
}
</style>
