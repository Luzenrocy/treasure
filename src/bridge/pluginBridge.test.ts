import { describe, expect, it, vi } from 'vitest';
import { capabilityRegistry, MENU_CAPABILITY_VERSION, REQUEST_TYPE_BY_CAPABILITY, isExpectedPluginOrigin, isKnownRequestType, requestTypeToCapability, responseTypeForRequestType, toResult, MENU_LABEL_ALIASES, findSubmenuRecursive, removeMenuItem, moveItemToEnd, mountPluginMenus, type MenuBuilderDeps } from './pluginBridge';

describe('menu bridge contract', () => {
  it('registers versioned menu operations with payload validation (建议 4: 结构校验增强)', () => {
    expect(MENU_CAPABILITY_VERSION).toBe(2);
    // 合法注册
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'View', items: [{ id: 'a', label: 'A', type: 'check', checked: false }] })).toBe(true);
    expect(capabilityRegistry['menus.update']).toBeUndefined();
    // 缺失 rootLabel 或 rootLabel 不在宿主已知系统菜单名集合
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', items: [{ id: 'a', label: 'A' }] })).toBe(false);
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'UnknownRoot', items: [{ id: 'a', label: 'A' }] })).toBe(false);
    // items 为空、条目缺 id/label、type 非法
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'View', items: [] })).toBe(false);
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'View', items: [{ label: 'A' }] })).toBe(false);
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'View', items: [{ id: 'a' }] })).toBe(false);
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: 'View', items: [{ id: 'a', label: 'A', type: 'bogus' }] })).toBe(false);
    // 本地化别名 rootLabel 也合法
    expect(capabilityRegistry['menus.register'].validate({ menuId: 'm', rootLabel: '显示', items: [{ id: 'a', label: 'A' }] })).toBe(true);
    expect(capabilityRegistry['menus.subscribe'].validate({ menuId: 'm', token: 't' })).toBe(true);
    expect(capabilityRegistry['menus.unsubscribe'].validate({ token: 't' })).toBe(true);
    expect(capabilityRegistry['menus.subscribe'].validate({ menuId: 'm' })).toBe(false);
    // 轻量勾选更新路径（建议 3）
    expect(capabilityRegistry['menus.updateChecked'].validate({ menuId: 'm', itemId: 'a', checked: true })).toBe(true);
    expect(capabilityRegistry['menus.updateChecked'].validate({ menuId: 'm', itemId: 'a' })).toBe(false);
    expect(capabilityRegistry['menus.updateChecked'].validate({ menuId: 'm', checked: true })).toBe(false);
    expect(toResult({ code: 0, msg: 'unsupported' }, 'menus.register')).toMatchObject({ ok: false });
  });
});

describe('capability-scoped request types (方案 B: 按能力域拆分消息类型)', () => {
  it('covers every capability registered in the host registry', () => {
    const registeredCapabilities = new Set(Object.values(capabilityRegistry).map(entry => entry.capability));
    expect(Object.keys(REQUEST_TYPE_BY_CAPABILITY).sort()).toEqual(Array.from(registeredCapabilities).sort());
  });

  it('recognizes every capability request envelope keyword', () => {
    for (const requestType of Object.values(REQUEST_TYPE_BY_CAPABILITY)) {
      expect(isKnownRequestType(requestType)).toBe(true);
    }
    expect(isKnownRequestType('treasure-menu-requestx')).toBe(false);
    expect(isKnownRequestType('treasure-menu-response')).toBe(false);
    expect(isKnownRequestType(undefined)).toBe(false);
  });

  it('maps request types back to capabilities', () => {
    expect(requestTypeToCapability('treasure-menu-request')).toBe('menus');
    expect(requestTypeToCapability('treasure-file-request')).toBe('files');
    expect(requestTypeToCapability('treasure-db-request')).toBe('database');
    expect(requestTypeToCapability('treasure-unknown-request')).toBeUndefined();
  });

  it('derives the response type from the request type', () => {
    expect(responseTypeForRequestType('treasure-menu-request')).toBe('treasure-menu-response');
    expect(responseTypeForRequestType('treasure-db-request')).toBe('treasure-db-response');
    expect(responseTypeForRequestType('treasure-file-request')).toBe('treasure-file-response');
    expect(responseTypeForRequestType('treasure-setting-request')).toBe('treasure-setting-response');
  });

  it('keeps the SDK message type table in sync with the host table', () => {
    // 契约测试：宿主与 SDK 的映射必须一致（对应 treasure-sdk bridge.test.ts）。
    const expected: Record<string, string> = {
      files: 'treasure-file-request',
      directories: 'treasure-directory-request',
      storage: 'treasure-storage-request',
      database: 'treasure-db-request',
      settings: 'treasure-setting-request',
      permissions: 'treasure-permission-request',
      menus: 'treasure-menu-request',
      notifications: 'treasure-notification-request',
      logs: 'treasure-log-request',
    };
    expect(REQUEST_TYPE_BY_CAPABILITY).toEqual(expected);
  });
});

describe('installed plugin origins', () => {
  function installFrame(src: string): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    frame.dataset.treasurePlugin = 'example';
    frame.setAttribute('src', src);
    document.body.append(frame);
    return frame;
  }

  it('accepts the WebView2 custom-protocol origin only for a Windows plugin frame', () => {
    const frame = installFrame('http://plugin.localhost/plugin/example/index.html');
    expect(isExpectedPluginOrigin(frame.contentWindow, 'http://plugin.localhost')).toBe(true);
    expect(isExpectedPluginOrigin(frame.contentWindow, null)).toBe(false);
    expect(isExpectedPluginOrigin(frame.contentWindow, 'plugin://localhost')).toBe(false);
    frame.remove();
  });

  it('keeps the opaque-origin compatibility path exclusive to macOS plugin frames', () => {
    const frame = installFrame('plugin://localhost/plugin/example/index.html');
    expect(isExpectedPluginOrigin(frame.contentWindow, null)).toBe(true);
    expect(isExpectedPluginOrigin(frame.contentWindow, 'plugin://localhost')).toBe(true);
    expect(isExpectedPluginOrigin(frame.contentWindow, 'http://plugin.localhost')).toBe(false);
    frame.remove();
  });
});

describe('MenuBuilder (建议 5: 菜单构建解耦与可测性)', () => {
  function fakeItem(text: string, children?: unknown[]) {
    const item: any = {
      text,
      append: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    if (children !== undefined) item.items = vi.fn(async () => children);
    return item;
  }

  it('findSubmenuRecursive matches by label or localized alias', async () => {
    const items = [fakeItem('文件', [fakeItem('导出')])];
    // 调用方负责展开别名列表（如 ['File', '文件']）
    expect(await findSubmenuRecursive(items, ['File', '文件'])).toBe(items[0]);
    expect(await findSubmenuRecursive(items, ['Nope'])).toBeNull();
    expect(await findSubmenuRecursive(items, ['导出'])).toBe((await items[0].items())[0]);
  });

  it('moveItemToEnd relocates a matched item to the end of its parent', async () => {
    const a = fakeItem('A'), b = fakeItem('B');
    const parent: any = { items: vi.fn(async () => [a, b]), remove: vi.fn(async () => undefined), append: vi.fn(async () => undefined) };
    await moveItemToEnd(parent, ['A']);
    expect(parent.remove).toHaveBeenCalledWith(a);
    expect(parent.append).toHaveBeenCalledWith(a);
  });

  it('removeMenuItem removes the first matched item from its parent', async () => {
    const a = fakeItem('A'), b = fakeItem('B');
    const parent: any = { items: vi.fn(async () => [a, b]), remove: vi.fn(async () => undefined), append: vi.fn(async () => undefined) };
    await removeMenuItem(parent, ['B']);
    expect(parent.remove).toHaveBeenCalledWith(b);
  });

  it('mountPluginMenus caches handles and appends to the located system root', async () => {
    const cached: Array<{ menuId: string; itemId: string }> = [];
    const created: Array<{ kind: string; text: string; checked?: boolean }> = [];
    const deps: MenuBuilderDeps = {
      cacheHandle: (_pc, menuId, itemId) => cached.push({ menuId, itemId }),
      newSubmenu: async (text, _items) => { created.push({ kind: 'submenu', text }); return { append: vi.fn(async () => undefined) }; },
      newCheckMenuItem: async (opts) => { created.push({ kind: 'check', text: opts.text, checked: opts.checked }); return {}; },
      newMenuItem: async (opts) => { created.push({ kind: 'item', text: opts.text }); return {}; },
      newSeparator: async () => { created.push({ kind: 'sep', text: '' }); return {}; },
    };
    const rootAppend = vi.fn(async () => undefined);
    const rootMenu: any = { append: rootAppend };
    const viewMenu = fakeItem('View');
    const menuItems = [viewMenu];

    await mountPluginMenus(
      deps,
      'excalidraw',
      [{ menuId: 'excalidraw.view', rootLabel: 'View', submenuLabel: 'Excalidraw', items: [
        { id: 'drawing-mode', label: 'Drawing', type: 'check', checked: true },
        { id: 'sep1', label: '', type: 'separator' },
        { id: 'new', label: 'New' },
      ] }],
      rootMenu,
      menuItems,
    );

    // 句柄缓存覆盖全部 item
    expect(cached.map(c => c.itemId)).toEqual(['drawing-mode', 'sep1', 'new']);
    // 构建按类型映射（check/separator/normal）
    expect(created).toEqual([
      { kind: 'check', text: 'Drawing', checked: true },
      { kind: 'sep', text: '' },
      { kind: 'item', text: 'New' },
      { kind: 'submenu', text: 'Excalidraw' },
    ]);
    // 有 submenuLabel 时挂到已定位的 View 父级（而非顶层）
    expect(viewMenu.append).toHaveBeenCalledTimes(1);
    expect(rootAppend).not.toHaveBeenCalled();
  });

  it('mountPluginMenus falls back to a top-level submenu when root is not found', async () => {
    const cached: Array<{ menuId: string; itemId: string }> = [];
    const deps: MenuBuilderDeps = {
      cacheHandle: (_pc, menuId, itemId) => cached.push({ menuId, itemId }),
      newSubmenu: async (_text, _items) => ({ append: vi.fn(async () => undefined) }),
      newCheckMenuItem: async () => ({}),
      newMenuItem: async () => ({}),
      newSeparator: async () => ({}),
    };
    const rootAppend = vi.fn(async () => undefined);
    const rootMenu: any = { append: rootAppend };
    // 没有任何系统菜单 → fallback 创建顶层
    await mountPluginMenus(
      deps,
      'shi-yu-lu',
      [{ menuId: 'm', rootLabel: 'File', items: [{ id: 'a', label: 'A' }] }],
      rootMenu,
      [],
    );
    expect(rootAppend).toHaveBeenCalledTimes(1);
  });

  it('MENU_LABEL_ALIASES covers core system roots bidirectionally', () => {
    for (const root of ['View', 'File', 'Edit', 'Window', 'Help']) {
      expect(MENU_LABEL_ALIASES[root]?.length).toBeGreaterThan(0);
    }
  });

  it('mountPluginMenus passes enabled through to normal and check items (建议 6: 落地 enabled 支持)', async () => {
    const received: Array<{ kind: string; enabled?: boolean }> = [];
    const deps: MenuBuilderDeps = {
      cacheHandle: () => undefined,
      newSubmenu: async (_text, _items) => ({ append: vi.fn(async () => undefined) }),
      newCheckMenuItem: async (opts) => { received.push({ kind: 'check', enabled: opts.enabled }); return {}; },
      newMenuItem: async (opts) => { received.push({ kind: 'item', enabled: opts.enabled }); return {}; },
      newSeparator: async () => { received.push({ kind: 'sep' }); return {}; },
    };
    const rootAppend = vi.fn(async () => undefined);
    const rootMenu: any = { append: rootAppend };
    const viewMenu = fakeItem('View');

    await mountPluginMenus(
      deps,
      'excalidraw',
      [{ menuId: 'm', rootLabel: 'View', items: [
        { id: 'check-a', label: 'A', type: 'check', checked: true, enabled: false },
        { id: 'normal-b', label: 'B', enabled: true },
      ] }],
      rootMenu,
      [viewMenu],
    );

    expect(received).toEqual([
      { kind: 'check', enabled: false },
      { kind: 'item', enabled: true },
    ]);
  });
});
