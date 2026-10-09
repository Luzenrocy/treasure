export interface MarketResponse<T> {
  code: number | string;
  message: string;
  data: T;
  requestId?: string;
}

export interface MarketPluginSummary {
  pluginCode: string;
  alias: string;
  description: string;
  author: string;
  iconUrl?: string;
  categories: string[];
  permissions: MarketPluginPermission[];
  minPlatformVersion: string;
  latestVersion: string;
  latestPublishedAt?: string;
  releaseCount?: number;
  homepage?: string;
  // 最新版本完整安装数据（详情接口返回，默认安装直接使用）
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  manifest?: Record<string, unknown>;
  changelog?: string;
}

export interface MarketPluginPermission {
  code?: string;
  name: string;
  risk?: 'low' | 'medium' | 'high' | string;
  description?: string;
}

export interface MarketRelease {
  pluginCode: string;
  version: string;
  status: 'published';
  downloadUrl: string;
  sha256: string;
  size: number;
  manifest: Record<string, unknown>;
  minPlatformVersion: string;
  permissions: MarketPluginPermission[];
  changelog?: string;
  publishedAt?: string;
}

export interface PluginListQuery {
  keyword?: string;
  category?: string;
}

export interface MarketListResult<T> {
  items: T[];
}

export interface MarketHealth {
  ok: boolean;
  apiVersion: string;
  service: string;
  timestamp: string;
}

export class PluginMarketError extends Error {
  code: number | string;
  requestId?: string;
  status?: number;

  constructor(message: string, code: number | string, requestId?: string, status?: number) {
    super(message);
    this.name = 'PluginMarketError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

export function normalizeMarketApiBaseUrl(input: string | null | undefined): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new PluginMarketError('插件市场 API 地址必须使用 HTTP 或 HTTPS', 'INVALID_API_BASE_URL');
  }

  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

function joinApiPath(baseUrl: string, path: string): string {
  return `${normalizeMarketApiBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestMarket<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  if (!normalizeMarketApiBaseUrl(baseUrl)) {
    throw new PluginMarketError('请先在系统设置中配置插件市场 API 地址', 'MARKET_API_NOT_CONFIGURED');
  }

  let response: Response;
  try {
    response = await fetch(joinApiPath(baseUrl, path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    });
  } catch (error) {
    throw new PluginMarketError(error instanceof Error ? error.message : '插件市场网络请求失败', 'NETWORK_ERROR');
  }

  let payload: MarketResponse<T>;
  try {
    payload = await response.json();
  } catch {
    throw new PluginMarketError('插件市场返回了无效 JSON', 'INVALID_JSON', undefined, response.status);
  }

  if (!response.ok || payload.code !== 0) {
    throw new PluginMarketError(payload.message || '插件市场请求失败', payload.code || response.status, payload.requestId, response.status);
  }

  return payload.data;
}

export async function fetchMarketHealth(baseUrl: string): Promise<MarketHealth> {
  return requestMarket<MarketHealth>(baseUrl, '/health');
}

export async function fetchMarketPlugins(baseUrl: string, query: PluginListQuery = {}): Promise<MarketListResult<MarketPluginSummary>> {
  const params = new URLSearchParams();
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.category) params.set('category', query.category);
  const qs = params.toString();
  return requestMarket<MarketListResult<MarketPluginSummary>>(baseUrl, `/plugins${qs ? `?${qs}` : ''}`);
}

export async function fetchMarketPlugin(baseUrl: string, pluginCode: string): Promise<MarketPluginSummary> {
  return requestMarket<MarketPluginSummary>(baseUrl, `/plugins/${encodeURIComponent(pluginCode)}`);
}

export async function fetchMarketReleases(baseUrl: string, pluginCode: string): Promise<MarketRelease[]> {
  const result = await requestMarket<MarketListResult<MarketRelease>>(baseUrl, `/plugins/${encodeURIComponent(pluginCode)}/releases`);
  return result.items;
}
