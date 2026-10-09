import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  PluginMarketError,
  fetchMarketHealth,
  fetchMarketPlugins,
  fetchMarketReleases,
  normalizeMarketApiBaseUrl,
} from './pluginMarketClient';

describe('normalizeMarketApiBaseUrl', () => {
  it('trims and removes trailing slashes, query and hash', () => {
    expect(normalizeMarketApiBaseUrl(' https://market.example.com/api/v1/?debug=1#x ')).toBe('https://market.example.com/api/v1');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeMarketApiBaseUrl('')).toBe('');
  });

  it('rejects non-http protocols', () => {
    expect(() => normalizeMarketApiBaseUrl('file:///tmp/market')).toThrow(PluginMarketError);
  });
});

describe('plugin market client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses unified success response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: { ok: true, apiVersion: 'v1', service: 'market', timestamp: '2026-09-28T00:00:00Z' },
      requestId: 'req_1',
    }), { status: 200 })));

    await expect(fetchMarketHealth('https://market.example.com/api/v1')).resolves.toMatchObject({ ok: true, apiVersion: 'v1' });
    expect(fetch).toHaveBeenCalledWith('https://market.example.com/api/v1/health', expect.any(Object));
  });

  it('passes keyword/category query parameters only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: { items: [] },
    }), { status: 200 })));

    await fetchMarketPlugins('https://market.example.com/api/v1/', {
      keyword: 'json',
      category: '开发工具',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://market.example.com/api/v1/plugins?keyword=json&category=%E5%BC%80%E5%8F%91%E5%B7%A5%E5%85%B7',
      expect.any(Object),
    );
  });

  it('fetches releases list and maps items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: {
        items: [{
          pluginCode: 'json-formatter',
          version: '1.0.0',
          status: 'published',
          downloadUrl: 'https://cdn.example.com/json-formatter-1.0.0.zip',
          sha256: 'ab',
          size: 1,
          manifest: {},
          minPlatformVersion: '2.0.0',
          permissions: [],
          changelog: 'c',
          publishedAt: '2026-09-24T00:00:00Z',
        }],
      },
    }), { status: 200 })));

    const items = await fetchMarketReleases('https://market.example.com/api/v1', 'json-formatter');
    expect(fetch).toHaveBeenCalledWith(
      'https://market.example.com/api/v1/plugins/json-formatter/releases',
      expect.any(Object),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ version: '1.0.0', downloadUrl: 'https://cdn.example.com/json-formatter-1.0.0.zip' });
  });

  it('throws typed error for API failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'PLUGIN_NOT_FOUND',
      message: '插件不存在',
      data: null,
      requestId: 'req_2',
    }), { status: 404 })));

    await expect(fetchMarketHealth('https://market.example.com/api/v1')).rejects.toMatchObject({
      code: 'PLUGIN_NOT_FOUND',
      requestId: 'req_2',
      status: 404,
    });
  });
});
