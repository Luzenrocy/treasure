import { describe, expect, it } from 'vitest';
import { resolveIconRef, getPathIconRenderKind, normalizeIconPath } from './iconResolver';
import { isPresetIcon } from '@/constants/presetIcons';

describe('iconResolver 菜单图标解析', () => {
  it('将插件菜单图标相对路径解析为 path 类型', () => {
    const result = resolveIconRef('assets/json-formatter-menu.svg');
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      type: 'path',
      src: 'assets/json-formatter-menu.svg',
      normalizedPath: 'assets/json-formatter-menu.svg',
    });
  });

  it('对 text-diff 菜单图标同样解析为 path 类型', () => {
    const result = resolveIconRef('assets/text-diff-menu.svg');
    expect(result).toMatchObject({
      type: 'path',
      normalizedPath: 'assets/text-diff-menu.svg',
    });
  });

  it('svg 路径的渲染类型为 inline-svg', () => {
    expect(getPathIconRenderKind('assets/json-formatter-menu.svg')).toBe('inline-svg');
  });

  it('相对路径不会被误判为预设图标', () => {
    expect(isPresetIcon('assets/json-formatter-menu.svg')).toBe(false);
    expect(isPresetIcon('assets/text-diff-menu.svg')).toBe(false);
  });

  it('预设图标名解析为 preset 类型', () => {
    const result = resolveIconRef('Document');
    expect(result).toMatchObject({ type: 'preset', src: 'Document' });
    expect(isPresetIcon('Document')).toBe(true);
  });

  it('空引用解析为 null', () => {
    expect(resolveIconRef('')).toBeNull();
  });

  it('normalizeIconPath 去除前导 ./ 和 /', () => {
    expect(normalizeIconPath('./assets/icon.svg')).toBe('assets/icon.svg');
    expect(normalizeIconPath('/assets/icon.svg')).toBe('assets/icon.svg');
    expect(normalizeIconPath('assets/icon.svg')).toBe('assets/icon.svg');
  });
});
