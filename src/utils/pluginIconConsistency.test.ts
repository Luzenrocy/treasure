import { describe, expect, it } from 'vitest';
import { resolveIconRef, getPathIconRenderKind } from './iconResolver';

/**
 * 验证 PluginIcon 对插件菜单图标的解析一致性：
 * - 任意插件菜单图标（assets/xxx.svg）都解析为 path 类型 + inline-svg 渲染
 * - 解析失败时统一走 fallback（imageError）分支
 */
describe('PluginIcon 图标解析行为一致性', () => {
  it('插件菜单图标统一解析为 path 类型 + inline-svg 渲染', () => {
    const json = resolveIconRef('assets/json-formatter-menu.svg');
    const td = resolveIconRef('assets/text-diff-menu.svg');
    expect(json).toMatchObject({ type: 'path', normalizedPath: 'assets/json-formatter-menu.svg' });
    expect(td).toMatchObject({ type: 'path', normalizedPath: 'assets/text-diff-menu.svg' });
    expect(getPathIconRenderKind(json!.normalizedPath!)).toBe('inline-svg');
    expect(getPathIconRenderKind(td!.normalizedPath!)).toBe('inline-svg');
  });

  it('无图标引用 / 缺 pluginCode 时统一 fallback（imageError 分支）', () => {
    // 模拟 PluginIcon.vue resolvePathIcon 的前置分支
    const simulate = (iconRef: string, pluginCode: string) => {
      const resolved = resolveIconRef(iconRef);
      if (!resolved) return { imageError: true };
      if (!pluginCode || !resolved.normalizedPath) return { imageError: true };
      const renderKind = getPathIconRenderKind(resolved.normalizedPath);
      if (!renderKind) return { imageError: true };
      return { imageError: false, renderKind };
    };
    expect(simulate('', 'json-formatter-0fmko9')).toEqual({ imageError: true });
    expect(simulate('assets/icon.svg', '')).toEqual({ imageError: true });
    expect(simulate('assets/menu.svg', 'json-formatter-0fmko9')).toEqual({
      imageError: false,
      renderKind: 'inline-svg',
    });
  });
});