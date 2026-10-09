import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import type { MarketRelease } from '@/services/pluginMarketClient';
import {
  getPluginByCode,
  isPluginCodeExists,
  provisionPluginResources,
  runPluginInitScripts,
  upgradePlugin,
  upgradePluginSettings,
  validateManifest,
} from '@/sql/platformService';
import { execute } from '@/sql/common';
import { findPluginPackageRoot } from '@/components/pluginManager/packageImport';
import { useMenuStore } from '@/store/menu';
import { useTabsStore } from '@/store/tabs';

export interface InstallProgress {
  phase: 'downloading' | 'hashing' | 'extracting' | 'validating' | 'importing' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
}

export interface PluginInstallOptions {
  allowedHosts?: string[];
  maxSizeBytes?: number;
  signal?: AbortSignal;
  onProgress?: (p: InstallProgress) => void;
}

export const DEFAULT_ALLOWED_DOWNLOAD_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'huggingface.co',
  'huggingface.com',
];
export const DEFAULT_MAX_SIZE_BYTES = 512 * 1024 * 1024;

/**
 * Download, verify and install (or upgrade) a plugin from a marketplace release.
 * Reuses the host's existing import pipeline (upgradePlugin / fresh insert).
 */
export async function installPluginFromMarket(release: MarketRelease, options: PluginInstallOptions = {}): Promise<void> {
  const allowed = options.allowedHosts ?? DEFAULT_ALLOWED_DOWNLOAD_HOSTS;
  const maxBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const emit = (progress: InstallProgress) => options.onProgress?.(progress);
  const isCancelled = () => !!options.signal?.aborted;

  // 1. HTTPS allow-list URL
  const url = allowedDownloadUrl(release.downloadUrl, allowed);
  url.search = '';

  // 2. download to buffer
  emit({ phase: 'downloading', progress: 0 });
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    options.signal.addEventListener('abort', () => controller.abort());
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal, redirect: 'follow' });
  } catch (e) {
    if (controller.signal.aborted) { emit({ phase: 'cancelled', progress: 0 }); return; }
    throw new Error(`下载插件包失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!response.ok) throw new Error(`下载插件包失败：HTTP ${response.status}`);

  const blob = await response.blob();
  if (blob.size > maxBytes) throw new Error('插件包超过允许的下载大小上限');
  if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }
  emit({ phase: 'hashing', progress: 30 });

  // 3. SHA-256
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (release.sha256) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex.toLowerCase() !== release.sha256.toLowerCase()) {
      throw new Error('SHA-256 校验失败，插件包可能已被篡改');
    }
  }
  if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }

  // 4. write tmp zip + extract
  const base = await appDataDir();
  const cdName = parseContentDisposition(response.headers.get('content-disposition') || '');
  const zipName = cdName || `${release.pluginCode}-${release.version}.zip`;
  const tmpRoot = `${base}/tmp/market_${Date.now()}_${safeSegment(zipName)}`;
  const zipPath = `${tmpRoot}/package.zip`;
  const extractDir = `${tmpRoot}/extracted`;
  await mkdir(tmpRoot, { recursive: true });
  await writeBinaryFile(zipPath, bytes);
  emit({ phase: 'extracting', progress: 55, message: '正在解压插件包' });
  try {
    await invoke('extract_zip', { zipPath, targetDir: extractDir });
  } catch (e) {
    await cleanupTmp(tmpRoot);
    throw new Error(`解压失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }

  try {
    // 5. find package root
    const root = await findPluginPackageRoot(extractDir, { exists, readDir });
    if (!root.ok) throw new Error(root.error);
    const packageDir = root.value;
    emit({ phase: 'validating', progress: 70, message: '校验插件信息' });

    // 6. manifest
    const manifestPath = `${packageDir}/manifest.json`;
    if (!(await exists(manifestPath))) throw new Error('未找到 manifest.json');
    const manifest = JSON.parse(await readTextFile(manifestPath));
    const check = validateManifest(manifest);
    if (!check.valid) throw new Error(`manifest 校验失败: ${check.errors.join('; ')}`);
    if (manifest.name !== release.pluginCode) throw new Error(`manifest.name(${manifest.name}) 与市场编码(${release.pluginCode})不一致`);
    if (manifest.version !== release.version) throw new Error(`manifest.version(${manifest.version}) 与市场版本(${release.version})不一致`);
    if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }

    // 7. import via existing pipeline
    emit({ phase: 'importing', progress: 85, message: '写入插件系统' });
    if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }
    const targetDir = `${base}/plugin/${manifest.name}`;
    await mkdir(targetDir, { recursive: true });

    const usedId = await upsertPlugin(manifest, packageDir, targetDir);
    if (usedId === null) throw new Error('插件注册失败');

    await invoke('copy_directory', { from: packageDir, to: targetDir });
    await runPluginInitScripts(usedId, manifest.name, targetDir);
    useTabsStore().removeTabsByPluginCode(manifest.name);
    useMenuStore().fetchMenus();

    if (isCancelled()) { emit({ phase: 'cancelled', progress: 0 }); return; }
    emit({ phase: 'succeeded', progress: 100 });
  } catch (e) {
    throw e;
  } finally {
    await cleanupTmp(tmpRoot);
  }
}

/** Insert (fresh) or upgrade (existing) the plugin in tp_plugin; returns plugin id. */
async function upsertPlugin(manifest: any, _packageDir: string, _targetDir: string): Promise<number | null> {
  const existsRes = await isPluginCodeExists(manifest.name);
  const existsPlugin = existsRes.code === 1 && existsRes.data === true;
  const getRes = await getPluginByCode(manifest.name);

  if (existsPlugin && getRes.code === 1) {
    const existingId = (getRes.data as any)?.id;
    const up = await upgradePlugin(manifest.name, manifest);
    if (up.code === 1) {
      await upgradePluginSettings(existingId, manifest.name, manifest.settings || [], Date.now());
    }
    return existingId;
  }

  const now = Date.now();
  const insert = await execute(
    `INSERT INTO tp_plugin (plugin_code, plugin_alias, plugin_version, plugin_desc, plugin_author, plugin_icon, plugin_entry, plugin_location, has_init_script, has_destroy_script, plugin_type, plugin_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [manifest.name, manifest.alias, manifest.version, manifest.description || '', manifest.author || '', manifest.icon || '', manifest.entry, manifest.name, 0, 0, 0, manifest.plugin_uid || null, now, now],
  );
  if (insert.code !== 1) return null;
  const pluginId: number = insert.data?.lastInsertId;
  if (manifest.menu) {
    await execute(
      `INSERT INTO tp_menu (menu_id, menu_name, menu_type, menu_level, parent_id, menu_path, menu_icon, show_type, show_order, hidden, plugin_id, created_at, updated_at) VALUES (?, ?, 2, 1, NULL, ?, ?, 2, ?, 0, ?, ?, ?)`,
      [manifest.menu.id || `plugin_${manifest.name}`, manifest.menu.name, `/plugin/${manifest.name}`, manifest.menu.icon || '', manifest.menu.order || 0, pluginId, now, now],
    );
  }
  await provisionPluginResources(pluginId, manifest.name, manifest, now);
  return pluginId;
}

async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await writeFile(path, bytes);
}

function safeSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

/** Parse a valid HTTPS absolute URL against the allow-list. Returns the URL host. */
export function allowedDownloadUrl(rawUrl: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('插件下载地址不是有效 URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('插件下载地址必须使用 HTTPS');
  }
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error(`下载地址主机不在允许的下载域名内：${url.hostname}`);
  }
  return url;
}

/** Read a filename from a Content-Disposition header. */
export function parseContentDisposition(header: string): string {
  const match = /filename=(?:"([^"]+)"|([^;]+))/i.exec(header || '');
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

async function cleanupTmp(dir: string): Promise<void> {
  try { await invoke('delete_directory', { path: dir }); } catch { /* ignore */ }
}