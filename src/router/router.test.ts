import { vi, describe, it, expect, beforeAll } from 'vitest';
import type { Router } from 'vue-router';

// vue-router 的 createWebHistory 与 element-plus 依赖浏览器全局对象。
// 仅用于实例化 router 并读取路由表（hasRoute），最小 stub 即可。
const windowStub = {
  history: {
    state: null,
    options: {},
    replaceState() {},
    pushState() {},
  },
  location: {
    href: 'http://localhost/',
    pathname: '/',
    search: '',
    hash: '',
  },
  navigator: { userAgent: 'vitest' },
  addEventListener() {},
  removeEventListener() {},
} as unknown as Window & typeof globalThis;

vi.stubGlobal('window', windowStub);
vi.stubGlobal('location', windowStub.location);
vi.stubGlobal('document', {
  documentElement: { dataset: {} },
  createElement: () => ({ style: {}, dataset: {} }),
  createElementNS: () => ({ style: {}, dataset: {} }),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
} as unknown as Document);
vi.stubGlobal('navigator', { userAgent: 'vitest' });

let router: Router;

beforeAll(async () => {
  const module = await import('@/router');
  router = module.default;
});

describe('路由结构 —— 插件市场与插件中心的关系', () => {
  it('插件中心是独立路由页面（顶级标签页）', () => {
    expect(router!.hasRoute('pluginManager')).toBe(true);
  });

  it('插件市场不再是独立路由页面，而是插件中心的子页面', () => {
    expect(router!.hasRoute('pluginMarket')).toBe(false);
  });

  it('插件页路由保持可用', () => {
    expect(router!.hasRoute('plugin')).toBe(true);
  });
});