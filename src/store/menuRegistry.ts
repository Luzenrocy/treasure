import { defineStore } from 'pinia';
import { useTabsStore } from './tabs';

/**
 * 菜单项定义 —— 插件声明的单个菜单条目
 * @property type: 'check' 表示带勾选框的菜单项，'normal' 为普通项，'separator' 为分隔线
 */
export interface MenuItemDef {
  id: string;
  label: string;
  type: 'normal' | 'check' | 'separator';
  checked?: boolean;
  accelerator?: string;
}

/**
 * 插件菜单注册信息
 * @property rootLabel: 所属顶层菜单名（如 "View"），宿主据此将 items 挂到系统菜单下
 */
export interface MenuRegistration {
  menuId: string;
  rootLabel: string;     // 挂载目标系统菜单名（如 "View"、"File"）
  submenuLabel?: string; // 在系统菜单下显示的次级菜单名（如 "Mode/模式"、"导出/Export"）
  items: MenuItemDef[];
}

/** 内部句柄缓存 —— 记录 Tauri CheckMenuItem 实例，供后续 setChecked 更新勾选状态 */
interface HandleCache {
  pluginCode: string;
  menuId: string;
  handles: Map<string, any>;
}

/**
 * 插件菜单注册中心（Pinia Store）
 *
 * 职责：
 * 1. 维护「pluginCode → MenuRegistration[]」映射表
 * 2. 缓存 Tauri 菜单句柄，支持 updateState 不重建菜单直接更新勾选
 * 3. menuVersion 递增触发 frame 组件 watch，自动重建窗口菜单
 */
export const useMenuRegistry = defineStore('menuRegistry', {
  state: () => ({
    registrations: new Map<string, MenuRegistration[]>(),
    handleCache: new Map<string, HandleCache>(),
    menuVersion: 0,  // 每次 register/unregister 递增，frame watch 此值触发 rebuildMenu
  }),

  actions: {
    /** 注册插件菜单（如已存在同 menuId 则覆盖） */
    register(pluginCode: string, reg: MenuRegistration) {
      const list = this.registrations.get(pluginCode) || [];
      const idx = list.findIndex(r => r.menuId === reg.menuId);
      if (idx >= 0) list[idx] = reg;
      else list.push(reg);
      this.registrations.set(pluginCode, list);
      this.menuVersion++;
    },

    /** 注销指定菜单 */
    unregister(pluginCode: string, menuId: string) {
      const list = this.registrations.get(pluginCode);
      if (!list) return;
      const filtered = list.filter(r => r.menuId !== menuId);
      if (filtered.length === 0) this.registrations.delete(pluginCode);
      else this.registrations.set(pluginCode, filtered);
      this.handleCache.delete(`${pluginCode}:${menuId}`);
      this.menuVersion++;
    },

    /** 注销插件全部菜单（tab 关闭时兜底清理） */
    unregisterAll(pluginCode: string) {
      this.registrations.delete(pluginCode);
      for (const [key, cache] of this.handleCache) {
        if (cache.pluginCode === pluginCode) this.handleCache.delete(key);
      }
      this.menuVersion++;
    },

    /** 获取当前活跃插件的菜单注册列表 */
    getActiveRegistrations(): MenuRegistration[] {
      const tabsStore = useTabsStore();
      const code = tabsStore.activePluginCode;
      return code ? (this.registrations.get(code) || []) : [];
    },

    /** 缓存 Tauri 菜单句柄，供 updateState 不重建直接 setChecked */
    cacheHandle(pluginCode: string, menuId: string, itemId: string, handle: any) {
      const key = `${pluginCode}:${menuId}`;
      let cache = this.handleCache.get(key);
      if (!cache) {
        cache = { pluginCode, menuId, handles: new Map() };
        this.handleCache.set(key, cache);
      }
      cache.handles.set(itemId, handle);
    },

    /** 清空所有注册和句柄缓存 */
    clearAll() {
      this.registrations.clear();
      this.handleCache.clear();
      this.menuVersion++;
    },
    clearHandles() {
      this.handleCache.clear();
    },

    /** 通过缓存句柄直接设置菜单项勾选状态（不重建菜单） */
    async updateState(pluginCode: string, menuId: string, itemId: string, checked: boolean) {
      const key = `${pluginCode}:${menuId}`;
      const cache = this.handleCache.get(key);
      const handle = cache?.handles.get(itemId);
      if (handle?.setChecked) {
        try { await handle.setChecked(checked); } catch (e) { /* 静默 */ }
      }
    },

    /** 同步更新注册表中的勾选状态，确保菜单重建时使用最新状态 */
    updateRegistrationChecked(pluginCode: string, menuId: string, itemId: string, checked: boolean) {
      const list = this.registrations.get(pluginCode);
      if (!list) return;
      for (const reg of list) {
        if (reg.menuId !== menuId) continue;
        for (const item of reg.items) {
          if (item.id === itemId) item.checked = checked;
        }
      }
    },
  },
});