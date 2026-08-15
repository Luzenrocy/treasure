import { describe, expect, it } from 'vitest';
import { findPluginPackageRoot, type PackageFileSystem } from './packageImport';

function fileSystem(files: string[], directories: Record<string, string[]> = {}): PackageFileSystem {
  return {
    exists: async path => files.includes(path),
    readDir: async path => (directories[path] || []).map(name => ({ name, isDirectory: true })),
  };
}

describe('findPluginPackageRoot', () => {
  it('accepts a selected directory package whose root contains manifest.json', async () => {
    const root = await findPluginPackageRoot('/build-output/my-plugin', fileSystem(['/build-output/my-plugin/manifest.json']));

    expect(root).toEqual({ ok: true, value: '/build-output/my-plugin' });
  });

  it('accepts a ZIP extraction directory with one package wrapper', async () => {
    const root = await findPluginPackageRoot('/tmp/extracted', fileSystem(
      ['/tmp/extracted/my-plugin/manifest.json'],
      { '/tmp/extracted': ['my-plugin'] },
    ));

    expect(root).toEqual({ ok: true, value: '/tmp/extracted/my-plugin' });
  });

  it('rejects an ambiguous directory instead of selecting an arbitrary package', async () => {
    const root = await findPluginPackageRoot('/build-output', fileSystem(
      ['/build-output/one/manifest.json', '/build-output/two/manifest.json'],
      { '/build-output': ['one', 'two'] },
    ));

    expect(root).toEqual({ ok: false, error: '请选择包含 manifest.json 的单个插件目录' });
  });
});
