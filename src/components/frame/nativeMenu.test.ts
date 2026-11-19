import { mockIPC } from '@tauri-apps/api/mocks';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import { useMenuRegistry } from '@/store/menuRegistry';
import { useTabsStore } from '@/store/tabs';
import Frame from './index.vue';

afterEach(() => vi.unstubAllGlobals());

it('applies the registered Shi-yu-lu File and View menus using native handles', async () => {
  vi.stubGlobal('window', { crypto: globalThis.crypto });
  vi.stubGlobal('navigator', { userAgent: 'Mac' });

  const labels = new Map<number, string>([[2, 'File'], [3, 'View']]);
  const children = new Map<number, string[]>();
  let nextRid = 4;
  let applied = false;
  mockIPC((command, payload) => {
    const { rid, items, options } = payload as {
      rid: number;
      items: unknown[];
      options?: { text?: string };
    };
    switch (command) {
      case 'plugin:menu|create_default': return [1, 'app-menu'];
      case 'plugin:menu|items': return rid === 1 ? [[2, 'file', 'Submenu'], [3, 'view', 'Submenu']] : [];
      case 'plugin:menu|text': return labels.get(rid);
      case 'plugin:menu|new': {
        const itemRid = nextRid++;
        labels.set(itemRid, options?.text ?? '');
        return [itemRid, `item-${itemRid}`];
      }
      case 'plugin:menu|append': {
        const appended = items.map(item => {
          // These items were already created. Tauri serializes existing resources as [rid, kind].
          if (!Array.isArray(item) || !labels.has(item[0])) throw new Error('Expected a Tauri menu item handle');
          return labels.get(item[0])!;
        });
        children.set(rid, [...(children.get(rid) ?? []), ...appended]);
        return undefined;
      }
      case 'plugin:menu|set_as_app_menu':
        applied = true;
        return null;
      default: throw new Error(`Unexpected Tauri command: ${command}`);
    }
  });

  setActivePinia(createPinia());
  const tabsStore = useTabsStore();
  const menuRegistry = useMenuRegistry();
  const pluginCode = 'shi-yu-lu-2lglfy';
  tabsStore.addTab({ path: `/plugin/${pluginCode}`, title: '石玉录', cacheKey: pluginCode, pluginCode });
  menuRegistry.register(pluginCode, {
    menuId: 'shi-yu-lu-close-file', rootLabel: 'File',
    items: [{ id: 'close', label: 'Close Current File', type: 'normal' }],
  });
  menuRegistry.register(pluginCode, {
    menuId: 'shi-yu-lu-export', rootLabel: 'File', submenuLabel: 'Export',
    items: [{ id: 'pdf', label: 'Export as PDF', type: 'normal' }],
  });
  menuRegistry.register(pluginCode, {
    menuId: 'shi-yu-lu-view', rootLabel: 'View', submenuLabel: 'Mode',
    items: [{ id: 'editOnly', label: 'Edit Only', type: 'check' }],
  });

  const { rebuildMenu, applyMenu } = Frame.methods!;
  await rebuildMenu.call({ tabsStore, menuRegistry, applyMenu });

  expect(children.get(2)?.slice(0, 2)).toEqual(['Close Current File', 'Export']);
  expect(children.get(3)).toEqual(['Mode']);
  expect(applied).toBe(true);
});
