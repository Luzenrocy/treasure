import { describe, expect, it } from 'vitest';
import { allowedDownloadUrl, parseContentDisposition } from './pluginMarketInstaller';

describe('pluginMarketInstaller helpers', () => {
  it('rejects non-HTTPS download URLs', () => {
    expect(() =>
      allowedDownloadUrl('http://cdn.example.com/a.zip', ['cdn.example.com']),
    ).toThrow(/HTTPS/);
  });

  it('rejects a host that is not allow-listed', () => {
    expect(() =>
      allowedDownloadUrl('https://evil.example.com/a.zip', ['cdn.example.com']),
    ).toThrow(/允许的下载域名/);
  });

  it('accepts an allow-listed HTTPS download URL', () => {
    const { host } = allowedDownloadUrl('https://cdn.example.com/a.zip', ['cdn.example.com']);
    expect(host).toBe('cdn.example.com');
  });

  it('respects a custom download host allow-list', () => {
    expect(() =>
      allowedDownloadUrl('https://github.com/owner/repo/releases/download/v1/plugin.zip', ['market.example.com']),
    ).toThrow(/允许的下载域名/);
    expect(allowedDownloadUrl('https://market.example.com/api/plugins/demo/releases/1.0.0/download', ['market.example.com']).hostname).toBe('market.example.com');
  });

  it('parses quoted Content-Disposition filenames', () => {
    expect(parseContentDisposition('attachment; filename="plugin-1.0.0.zip"')).toBe('plugin-1.0.0.zip');
  });

  it('falls back to empty filename for Content-Disposition without a name', () => {
    expect(parseContentDisposition('attachment')).toBe('');
  });
});
