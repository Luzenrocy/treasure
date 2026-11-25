import { describe, expect, it } from 'vitest';
import { installedPluginUrl, isInstalledPluginOrigin, isInstalledPluginUrl } from './pluginUrl';

describe('installed plugin URL', () => {
  const path = 'plugin/google-authenticator/index.html';

  it('uses the native custom protocol on macOS', () => {
    expect(installedPluginUrl(path, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'))
      .toBe('plugin://localhost/plugin/google-authenticator/index.html');
  });

  it('uses the localhost HTTP form required by WebView2 on Windows', () => {
    expect(installedPluginUrl(path, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'))
      .toBe('http://plugin.localhost/plugin/google-authenticator/index.html');
  });

  it('recognizes both platform origins but no external origin', () => {
    expect(isInstalledPluginUrl('plugin://localhost/plugin/example/index.html')).toBe(true);
    expect(isInstalledPluginUrl('http://plugin.localhost/plugin/example/index.html')).toBe(true);
    expect(isInstalledPluginOrigin('plugin://localhost')).toBe(true);
    expect(isInstalledPluginOrigin('http://plugin.localhost')).toBe(true);
    expect(isInstalledPluginOrigin(null)).toBe(false);
    expect(isInstalledPluginOrigin('https://example.com')).toBe(false);
  });

  it('rejects traversal segments', () => {
    expect(() => installedPluginUrl('../index.html', 'Windows')).toThrow('插件入口路径无效');
  });
});
