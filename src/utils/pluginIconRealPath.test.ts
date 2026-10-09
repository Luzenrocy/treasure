import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolveIconRef, getPathIconRenderKind } from './iconResolver';

// 项目未安装 @types/node，声明测试所需的最小 node 类型（运行时由 node 提供）
declare module 'node:fs' {
  export function existsSync(p: string): boolean;
  export function readdirSync(p: string): string[];
  export function readFileSync(p: string, encoding: 'utf-8'): string;
}

// 本机 Treasure appData 目录（对应 tauri.conf.json identifier=com.treasure）
const PLUGIN_ROOT = '/Users/luzenrocy/Library/Application Support/com.treasure/plugin';

describe('PluginIcon 真实文件加载链路（自适应插件目录）', () => {
  it('所有已安装插件的图标文件均能解析且为有效 SVG', () => {
    const dirs = existsSync(PLUGIN_ROOT)
      ? readdirSync(PLUGIN_ROOT).filter((d) => d !== '.DS_Store')
      : [];
    expect(dirs.length).toBeGreaterThan(0);

    // 对每个插件目录：校验 assets/ 下所有 svg 的解析与读取，以及根 icon.svg
    for (const dir of dirs) {
      const assetsDir = `${PLUGIN_ROOT}/${dir}/assets`;
      if (existsSync(assetsDir)) {
        const files = readdirSync(assetsDir).filter((f) => f.endsWith('.svg'));
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
          const resolved = resolveIconRef(`assets/${f}`);
          expect(resolved).not.toBeNull();
          expect(resolved!.type).toBe('path');
          expect(getPathIconRenderKind(resolved!.normalizedPath!)).toBe('inline-svg');
          const svg = readFileSync(`${assetsDir}/${f}`, 'utf-8');
          // 允许带 XML 声明（<?xml ...?>）的 Vite 产物，只要包含 <svg 根元素即可
          expect(svg.includes('<svg')).toBe(true);
        }
      }
      const iconSvg = `${PLUGIN_ROOT}/${dir}/icon.svg`;
      if (existsSync(iconSvg)) {
        const svg = readFileSync(iconSvg, 'utf-8');
        expect(svg.trim().startsWith('<svg')).toBe(true);
      }
    }
  });
});
