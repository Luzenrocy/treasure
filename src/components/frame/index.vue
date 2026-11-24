<script lang="ts">
import {defineComponent} from "vue";
import { ElMessage } from 'element-plus';
import menuItem from "@/components/frame/menuItem/index.vue"
import PluginView from "@/components/plugin/index.vue"
import DiamondIcon from "@/assets/diamond.svg?component"
import WindowsTitleBar from './WindowsTitleBar.vue';
import {useMenuStore} from "@/store/menu";
import {useTabsStore} from "@/store/tabs";
import {useMenuRegistry} from "@/store/menuRegistry";
import {MENU_LABEL_ALIASES, dispatchMenuEvent, findSubmenuRecursive, removeMenuItem, moveItemToEnd, mountPluginMenus} from "@/bridge/pluginBridge";
import {MenuItem} from '@/class';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {invoke} from '@tauri-apps/api/core';
import {Menu, Submenu, MenuItem as TauriMenuItem, CheckMenuItem, PredefinedMenuItem, type SubmenuOptions} from '@tauri-apps/api/menu';
import { logEvent } from '@/utils/logger';
import type {RouteLocationNormalizedLoaded} from 'vue-router';
import {
  buildApplicationMenu,
  type ApplicationMenuAction,
} from './applicationMenu';

export default defineComponent({
  name: 'frame',
  components: {menuItem, PluginView, DiamondIcon, WindowsTitleBar},
  data() {
    return {
      isCollapse: false,
      menus: [] as MenuItem[],
      menuStore: useMenuStore(),
      tabsStore: useTabsStore(),
      menuRegistry: useMenuRegistry(),
      menuRebuildTimer: null as number | null,
      isWindows: navigator.userAgent.includes('Windows'),
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
      if (this.isWindows) return;
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
    async rebuildMenu() {
      // Windows draws this model in the custom title bar. Do not attach a native
      // menu there, otherwise Windows reserves a second menu row below it.
      if (this.isWindows) return;
      try {
        const activeCode = this.tabsStore.activePluginCode;
        const regs = activeCode ? this.menuRegistry.getActiveRegistrations() : [];
        const menu = await Menu.default();
        this.menuRegistry.clearHandles();
        const menuItems = await menu.items();
        // 插件菜单构建委托给 MenuBuilder（建议 5：从组件解耦，便于单测与多平台适配）
        if (activeCode) {
          const cacheHandle = (pluginCode: string, menuId: string, itemId: string, handle: unknown) =>
            this.menuRegistry.cacheHandle(pluginCode, menuId, itemId, handle);
          // Tauri 通过 Submenu 的 rid 和 kind 识别已创建的原生菜单。
          const newSubmenu = (text: string, items: unknown[]): Promise<Submenu> =>
            Submenu.new({ text, items: items as SubmenuOptions['items'] });
          const newCheckMenuItem = (opts: { text: string; checked: boolean; enabled?: boolean; accelerator?: string; action: () => void }) =>
            CheckMenuItem.new(opts);
          const newMenuItem = (opts: { text: string; enabled?: boolean; accelerator?: string; action: () => void }) =>
            TauriMenuItem.new(opts);
          const newSeparator = () => PredefinedMenuItem.new({ item: 'Separator' });
          await mountPluginMenus(
            { cacheHandle, newSubmenu, newCheckMenuItem, newMenuItem, newSeparator },
            activeCode,
            regs,
            { append: (item: unknown) => menu.append(item as any) },
            menuItems,
          );
        }
        // 插件菜单追加到 View 菜单后，将"切换全屏"移到末尾，使插件菜单排在上面
        const viewSearchLabels = ['View', ...(MENU_LABEL_ALIASES['View'] || [])];
        const viewMenu = await findSubmenuRecursive(menuItems, viewSearchLabels);
        if (viewMenu) {
          const fullScreenLabels = ['Toggle Full Screen', 'Enter Full Screen', '切换全屏', '进入全屏'];
          await moveItemToEnd(viewMenu, fullScreenLabels);
        }
        // 宿主默认菜单：始终在 File 下追加关闭标签菜单
        const fileSearchLabels = ['File', ...(MENU_LABEL_ALIASES['File'] || [])];
        const fileMenu = await findSubmenuRecursive(menuItems, fileSearchLabels);
        if (fileMenu) {
          const sep = await PredefinedMenuItem.new({ item: 'Separator' });
          const closeTab = await TauriMenuItem.new({ text: 'Close Current Tab', action: () => this.removeTab(this.tabsStore.activeTab) });
          const closeAll = await TauriMenuItem.new({ text: 'Close All Tabs', action: () => this.closeAllPluginTabs() });
          await fileMenu.append(sep);
          await fileMenu.append(closeTab);
          await fileMenu.append(closeAll);
          // 移除系统预定义 Close Window（自带 ⌘W 快捷键会产生 X 符号），替换为自定义不带 accelerator 的版本
          const closeWindowLabels = ['Close Window', ...(MENU_LABEL_ALIASES['Close Window'] || [])];
          await removeMenuItem(fileMenu, closeWindowLabels);
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
        else if (!this.isWindows) await menu.setAsWindowMenu();
      } catch (e) { console.warn('Failed to apply native menu:', e); }
    },
    async handleWindowsMenuAction(action: ApplicationMenuAction) {
      if (action.target === 'plugin') {
        if (action.checkable && typeof action.checked === 'boolean') {
          this.menuRegistry.updateRegistrationChecked(
            action.pluginCode,
            action.menuId,
            action.itemId,
            action.checked,
          );
          await this.menuRegistry.updateState(
            action.pluginCode,
            action.menuId,
            action.itemId,
            action.checked,
          );
        }
        dispatchMenuEvent(action.pluginCode, action.menuId, action.itemId);
        return;
      }

      switch (action.command) {
        case 'closeCurrentTab':
          this.removeTab(this.tabsStore.activeTab);
          break;
        case 'closeAllTabs':
          this.closeAllPluginTabs();
          break;
        case 'closeWindow':
          await invoke('close_window');
          break;
        case 'minimize':
          await invoke('minimize_window');
          break;
        case 'toggleMaximize':
          await invoke('toggle_maximize_window');
          break;
        case 'toggleFullscreen':
          await invoke('toggle_fullscreen_window');
          break;
        case 'about':
          ElMessage.info('Treasure v1.0.0');
          break;
        default:
          this.executeEditCommand(action.command);
      }
    },
    executeEditCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') {
      const editorCommand: Record<typeof command, string> = {
        undo: 'undo',
        redo: 'redo',
        cut: 'cut',
        copy: 'copy',
        paste: 'paste',
        selectAll: 'selectAll',
      };
      document.execCommand(editorCommand[command]);
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
    },
    windowsApplicationMenu() {
      const activeCode = this.tabsStore.activePluginCode;
      return buildApplicationMenu(activeCode, activeCode ? this.menuRegistry.getActiveRegistrations() : []);
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
  <div class="main-container" :class="{ 'is-windows': isWindows }">
    <WindowsTitleBar
      v-if="isWindows"
      :menu-groups="windowsApplicationMenu"
      @menu-action="handleWindowsMenuAction"
      @minimize="handleWindowsMenuAction({ target: 'host', command: 'minimize' })"
      @toggle-maximize="handleWindowsMenuAction({ target: 'host', command: 'toggleMaximize' })"
      @close="handleWindowsMenuAction({ target: 'host', command: 'closeWindow' })"
    />
    <el-container class="window-content">
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

        <div class="drag-region" :data-tauri-drag-region="isWindows ? undefined : ''">
          <div class="brand" @mouseenter="!isWindows && showTrafficLights()" @mouseleave="!isWindows && hideTrafficLights()">
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
    <el-container class="workspace-content">
      <!-- 顶部标签页 -->
      <el-header height="40px !important" @mousedown="onHeaderMouseDown" @mouseenter="!isWindows && showTrafficLights()" @mouseleave="!isWindows && hideTrafficLights()">
        <!-- 空白div元素 用以优化页面布局并且实现窗口拖动功能 -->
        <div v-if="tabsStore.tabs.length ==0" :data-tauri-drag-region="isWindows ? undefined : ''"
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
  </div>
</template>

<style lang="scss" scoped>
@import url('https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap');

.main-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .window-content {
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1 1 auto;
  }

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
      height: 100%;
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
    height: calc(100% - 40px);
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
