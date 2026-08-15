/**
 * @file 插件桥接层 —— 宿主侧的 postMessage 监听与 action 分发核心
 *
 * 职责：
 *   1. 监听来自插件 iframe 的类型化能力请求
 *   2. 按能力注册表分发到对应处理函数
 *   3. 执行身份、权限、参数和 Rust AST SQL 安全校验
 *   4. 将统一 Result<T> 通过 `treasure-db-response` 回传给插件
 *
 * 通信协议：
 *   - 请求与响应格式 → treasure-sdk/docs/BRIDGE-PROTOCOL.md
 *   - Action 约定     → treasure-sdk/docs/BRIDGE-PROTOCOL.md
 *
 * 安全校验链路：
 *   ① origin 与 iframe 身份校验
 *   ② 能力注册表参数和资源授权校验
 *   ③ prepare_plugin_sql（Rust AST）— 验证并将裸表名重写为 "plugin_{pluginCode}_{table}"
 *   ④ PluginSqlExecutor.executeRequest — 执行 Rust 已验证的 SQL
 *
 * @packageDocumentation
 */

import { PluginSqlExecutor } from './pluginSqlExecutor';
import { mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getDirectoryAccessGrant, getPluginDirectoryPermission, getSettingsByPluginCode, grantPluginDirectoryPermission, revokePluginDirectoryPermission, saveSettingsByPluginCode, getSettingByKey, upsertSettingByKey } from '@/sql/platformService';
import { useMenuRegistry } from '@/store/menuRegistry';
import { useTabsStore } from '@/store/tabs';
import { logEvent } from '@/utils/logger';
import { FileGrantService, isPathWithinGrantedRoot } from './fileGrants';

/** 插件 SQL 安全执行器（全局单例） */
let executor: PluginSqlExecutor;
const fileGrants = new FileGrantService();

type Capability = 'files' | 'directories' | 'storage' | 'database' | 'settings' | 'permissions' | 'menus' | 'notifications' | 'logs';
interface CapabilityRegistration { capability: Capability; action: string; minPlatformVersion: '2.0.0'; validate: (payload: any) => boolean; }

/** `instanceof` is not reliable for structured-cloned data from plugin iframes. */
function isUint8Array(value: unknown): value is Uint8Array {
    const bytes = value as { BYTES_PER_ELEMENT?: unknown; length?: unknown } | null;
    return ArrayBuffer.isView(value) && bytes?.BYTES_PER_ELEMENT === 1 && typeof bytes.length === 'number';
}

function isPermissionKey(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

/** Normalizes Tauri/plugin errors without discarding string or structured rejections. */
function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error) return error;
    if (error && typeof error === 'object') {
        try { return JSON.stringify(error); } catch { /* fall through */ }
    }
    return '宿主操作失败';
}

/** Single protocol authority for the public SDK 2.0 operations. */
export const capabilityRegistry: Record<string, CapabilityRegistration> = {
    'database.query': { capability: 'database', action: 'query', minPlatformVersion: '2.0.0', validate: p => typeof p?.sql === 'string' && Array.isArray(p?.tables) },
    'database.execute': { capability: 'database', action: 'execute', minPlatformVersion: '2.0.0', validate: p => typeof p?.sql === 'string' && Array.isArray(p?.tables) },
    'database.transaction': { capability: 'database', action: 'transaction', minPlatformVersion: '2.0.0', validate: p => Array.isArray(p?.statements) },
    'files.openDialog': { capability: 'files', action: 'openDialog', minPlatformVersion: '2.0.0', validate: p => p?.kind === 'file' || p?.kind === 'directory' },
    'files.saveDialog': { capability: 'files', action: 'saveDialog', minPlatformVersion: '2.0.0', validate: p => isPlainFileName(p?.defaultFileName) && (!p.filters || Array.isArray(p.filters)) && (!p.initialDirectory || typeof p.initialDirectory.id === 'string') },
    'files.readFile': { capability: 'files', action: 'readGrantedFile', minPlatformVersion: '2.0.0', validate: p => typeof p?.file?.id === 'string' },
    'files.writeFile': { capability: 'files', action: 'writeGrantedFile', minPlatformVersion: '2.0.0', validate: p => isUint8Array(p?.data) && ((typeof p?.directory?.id === 'string' && isPlainFileName(p?.fileName)) || (typeof p?.file?.id === 'string' && !p?.directory && !p?.fileName)) },
    'directories.list': { capability: 'directories', action: 'listGrantedDirectory', minPlatformVersion: '2.0.0', validate: p => typeof p?.directory?.id === 'string' },
    'directories.create': { capability: 'directories', action: 'createGrantedDirectory', minPlatformVersion: '2.0.0', validate: p => typeof p?.directory?.id === 'string' && typeof p?.name === 'string' },
    'directories.remove': { capability: 'directories', action: 'removeGrantedDirectory', minPlatformVersion: '2.0.0', validate: p => typeof p?.directory?.id === 'string' },
    'storage.read': { capability: 'storage', action: 'readStorageFile', minPlatformVersion: '2.0.0', validate: p => typeof p?.key === 'string' },
    'storage.write': { capability: 'storage', action: 'writeStorageFile', minPlatformVersion: '2.0.0', validate: p => typeof p?.key === 'string' && isUint8Array(p?.data) },
    'storage.remove': { capability: 'storage', action: 'deleteStorageFile', minPlatformVersion: '2.0.0', validate: p => typeof p?.key === 'string' },
    'settings.list': { capability: 'settings', action: 'getSettings', minPlatformVersion: '2.0.0', validate: () => true },
    'settings.get': { capability: 'settings', action: 'getSettingByKey', minPlatformVersion: '2.0.0', validate: p => typeof p?.key === 'string' },
    'settings.set': { capability: 'settings', action: 'saveSettingByKey', minPlatformVersion: '2.0.0', validate: p => typeof p?.key === 'string' && typeof p?.value === 'string' },
    'permissions.grantDirectory': { capability: 'permissions', action: 'grantDirectory', minPlatformVersion: '2.0.0', validate: p => isPermissionKey(p?.permissionKey) && typeof p?.directory?.id === 'string' },
    'permissions.getDirectory': { capability: 'permissions', action: 'getGrantedDirectory', minPlatformVersion: '2.0.0', validate: p => isPermissionKey(p?.permissionKey) },
    'permissions.revokeDirectory': { capability: 'permissions', action: 'revokeDirectory', minPlatformVersion: '2.0.0', validate: p => isPermissionKey(p?.permissionKey) },
    'menus.register': { capability: 'menus', action: 'registerMenu', minPlatformVersion: '2.0.0', validate: p => typeof p?.menuId === 'string' && Array.isArray(p?.items) },
    'menus.unregister': { capability: 'menus', action: 'unregisterMenu', minPlatformVersion: '2.0.0', validate: p => typeof p?.id === 'string' },
    'notifications.send': { capability: 'notifications', action: 'sendNotification', minPlatformVersion: '2.0.0', validate: p => typeof p?.title === 'string' && typeof p?.body === 'string' },
    'logs.write': { capability: 'logs', action: 'log', minPlatformVersion: '2.0.0', validate: p => typeof p?.message === 'string' },
};

// Bound untrusted plugin work before it reaches the database worker. The Rust
// command is still authoritative for SQL syntax and namespaces.
const MAX_TRANSACTION_STATEMENTS = 50;
const MAX_DATABASE_PAYLOAD_BYTES = 256 * 1024;
const MAX_DATABASE_RESULT_ROWS = 1_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 向插件 iframe 发送响应消息
 *
 * @param source    - postMessage 的来源窗口对象（event.source）
 * @param origin    - 目标 origin（与插件 iframe 一致）
 * @param requestId - 请求唯一 ID（对应插件端的 PendingRequest）
 * @param data      - 宿主内部结果，发送前统一转换为 Result<T>
 */
async function sendResponse(source: Window, origin: string, requestId: string, data: any, operation?: string) {
    source.postMessage(
        { type: 'treasure-db-response', requestId, result: toResult(data, operation) },
        { targetOrigin: origin }
    );
}

export function toResult(data: any, operation?: string) {
    if (data?.ok === true || data?.ok === false) return data;
    if (data?.code === 1) {
        const value = data.data;
        // Settings are the one array-shaped non-database response.  Normalize
        // the legacy host records before applying the database rows envelope.
        if (Array.isArray(value)) {
            if (operation === 'database.transaction') return { ok: true, value };
            if (operation?.startsWith('settings.') && value.every(item => item && typeof item === 'object' && 'param_key' in item)) {
                return { ok: true, value: value.map(item => ({ key: item.param_key, value: item.param_value })) };
            }
            return { ok: true, value: { rows: value } };
        }
        if (value && typeof value === 'object' && 'param_key' in value) {
            return { ok: true, value: { key: value.param_key, value: value.param_value } };
        }
        if (value && typeof value === 'object' && ('rowsAffected' in value || 'lastInsertId' in value)) {
            return { ok: true, value: { affectedRows: value.rowsAffected || 0, lastInsertId: value.lastInsertId || 0, rows: value.rows } };
        }
        return { ok: true, value };
    }
    return { ok: false, error: { code: 'INTERNAL', message: data?.msg || '宿主操作失败' } };
}

/** MessageEvent.source is the authority for identity; message payload never selects a plugin. */
function pluginCodeFromSource(source: Window | null): string | undefined {
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-treasure-plugin]'))
        .find(candidate => candidate.contentWindow === source);
    return frame?.dataset.treasurePlugin;
}

/** A registered debug iframe may only use the exact origin it was registered with. */
export function isExpectedPluginOrigin(source: Window | null, origin: string | null): boolean {
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-treasure-plugin]'))
        .find(candidate => candidate.contentWindow === source);
    if (!frame) return false;

    const src = frame.getAttribute?.('src') || frame.src || '';
    if (src.startsWith('plugin://localhost/')) return origin === null || origin === 'plugin://localhost';
    try {
        return origin === new URL(src).origin;
    } catch {
        return false;
    }
}

/**
 * 初始化插件 iframe 通信桥接。
 *
 * 在应用启动时（main.ts）调用一次，全局生效。
 *
 * 工作流程：
 *   1. 创建 PluginSqlExecutor 实例
 *   2. 注册 window.message 监听器
 *   3. 对每条消息执行：origin 校验 → action 分发 → 执行 → 回响应
 *
 * @see dispatchMenuEvent 宿主→插件的反向事件（菜单事件）
 */
export function initPluginBridge() {
    executor = new PluginSqlExecutor();

    window.addEventListener('message', async (event) => {
        // ── 第 1 步：origin 校验 ──────────────────────────────
        // 已安装插件只能来自 plugin://localhost；调试插件必须精确匹配
        // 其登记开发地址的 origin。plugin:// 协议在部分 Webview 中为 null。
        const origin = event.origin ?? (event as any).originalEvent?.origin ?? null;

        await logEvent('debug', 'bridge', 'message received', { origin, operation: event.data?.operation });

        const data = event.data;
        if (!data || data.type !== 'treasure-db-request') return;

        const { requestId } = data;
        const source = event.source as Window;
        if (!isExpectedPluginOrigin(source, origin)) {
            sendResponse(source, origin || '*', requestId, { ok: false, error: { code: 'PERMISSION_DENIED', message: '插件来源未注册或与调试地址不匹配' } });
            return;
        }

        // ── 第 2 步：消息格式校验 ──────────────────────────────
        const pluginCode = pluginCodeFromSource(source);
        const operation = data.operation as string | undefined;
        const registration = operation ? capabilityRegistry[operation] : undefined;
        const action = registration?.action;
        const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
        if (!registration || !registration.validate(payload)) {
            sendResponse(source, origin, requestId, { ok: false, error: { code: 'VALIDATION_FAILED', message: '能力请求参数无效或不受支持' } });
            return;
        }
        Object.assign(data, payload);
        if (action === 'transaction') data.ops = payload.statements;
        if (action === 'readGrantedFile') data.fileId = payload.file?.id;
        if (action === 'writeGrantedFile') { data.directoryId = payload.directory?.id; data.fileId = payload.file?.id; data.fileName = payload.fileName; data.bytes = Array.from(payload.data || []); }
        if (action === 'writeStorageFile') { data.key = payload.key; data.bytes = Array.from(payload.data || []); }
        if (action === 'registerMenu') data.reg = payload;
        if (action === 'unregisterMenu') data.menuId = payload.id;
        if (action === 'getSettingByKey') data.paramKey = payload.key;
        if (action === 'saveSettingByKey') { data.paramKey = payload.key; data.paramValue = payload.value; }

        if (!pluginCode || !action) {
            sendResponse(source, origin, requestId, { ok: false, error: { code: 'PERMISSION_DENIED', message: '插件身份或能力无效' } });
            return;
        }

        if ((action === 'query' || action === 'execute' || action === 'transaction')
            && new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_DATABASE_PAYLOAD_BYTES) {
            sendResponse(source, origin, requestId, { ok: false, error: { code: 'VALIDATION_FAILED', message: '数据库请求参数超过大小限制' } });
            return;
        }
        if (action === 'transaction' && data.ops.length > MAX_TRANSACTION_STATEMENTS) {
            sendResponse(source, origin, requestId, { ok: false, error: { code: 'VALIDATION_FAILED', message: `事务最多允许 ${MAX_TRANSACTION_STATEMENTS} 条语句` } });
            return;
        }

        // ── 第 3 步：action 分发与执行 ─────────────────────────
        try {
            const start = performance.now();
            let result: any;

            switch (action) {
                // ── SQL 查询 / 写操作 ───────────────────────────
                // 流程：prepare_plugin_sql（Rust AST）→ PluginSqlExecutor
                case 'query':
                case 'execute': {
                    const { sql, tables, params } = data;
                    const prepared: any = await invoke('prepare_plugin_sql', { sql, declaredTables: tables || [], pluginCode, action });
                    const rewritten = prepared.sql;
                    result = await executor.executeRequest(pluginCode, action, rewritten, params);
                    if (action === 'query' && result?.code === 1 && Array.isArray(result.data) && result.data.length > MAX_DATABASE_RESULT_ROWS) {
                        result = { code: 0, msg: `查询结果超过 ${MAX_DATABASE_RESULT_ROWS} 行限制` };
                    }
                    break;
                }

                // ── SQL 事务 ──────────────────────────────────
                // 逐条验证 → 逐条重写 → 批量执行
                case 'transaction': {
                    const { ops } = data;
                    let failed = false;
                    // 逐条验证每一条 SQL 的表声明
                    for (const op of ops) {
                        try { await invoke('prepare_plugin_sql', { sql: op.sql, declaredTables: op.tables || [], pluginCode, action: 'execute' }); }
                        catch (error: any) { result = { code: 0, msg: `事务SQL声明验证失败: ${error}` }; failed = true; break; }
                    }
                    if (!failed) {
                        const rewrittenOps = await Promise.all(ops.map(async (op: any) => {
                            const prepared: any = await invoke('prepare_plugin_sql', { sql: op.sql, declaredTables: op.tables || [], pluginCode, action: 'execute' });
                            return { sql: prepared.sql, params: op.params };
                        }));
                        result = await executor.executeRequest(pluginCode, 'transaction', '', rewrittenOps);
                    }
                    break;
                }

                case 'readStorageFile':
                case 'writeStorageFile':
                case 'deleteStorageFile': {
                    const { appDataDir } = await import('@tauri-apps/api/path');
                    const base = `${await appDataDir()}/plugin/${pluginCode}/data`;
                    const path = FileGrantService.resolveStoragePath(base, data.key);
                    if (!path) { result = { ok: false, error: { code: 'VALIDATION_FAILED', message: '私有存储键无效' } }; break; }
                    if (action === 'readStorageFile') {
                        const bytes = await readFile(path);
                        result = bytes.byteLength > MAX_FILE_BYTES
                            ? { ok: false, error: { code: 'FILE_TOO_LARGE', message: `单个文件不能超过 ${MAX_FILE_BYTES} 字节` } }
                            : { ok: true, value: bytes };
                    }
                    else if (action === 'writeStorageFile') {
                        if (data.bytes.length > MAX_FILE_BYTES) { result = { ok: false, error: { code: 'FILE_TOO_LARGE', message: `单个文件不能超过 ${MAX_FILE_BYTES} 字节` } }; break; }
                        await mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true }); await writeFile(path, new Uint8Array(data.bytes)); result = { ok: true, value: undefined };
                    }
                    else { await invoke('move_to_trash', { path }); result = { ok: true, value: undefined }; }
                    break;
                }

                case 'listGrantedDirectory': {
                    const path = await resolveGrantedDirectory(pluginCode, data.directory?.id);
                    if (!path) { result = await deniedDirectoryAccess(pluginCode, action, data.directory?.id); break; }
                    const rootGrantId = fileGrants.getDirectoryGrant(pluginCode, data.directory.id)?.rootGrantId;
                    const entries = await readDir(path);
                    result = { ok: true, value: entries.map(entry => {
                        const childPath = `${path.replace(/[\\/]+$/, '')}/${entry.name}`;
                        return entry.isDirectory
                            ? { name: entry.name, kind: 'directory', directory: fileGrants.grantDirectory(pluginCode, childPath, rootGrantId) }
                            : { name: entry.name, kind: 'file', file: fileGrants.grantFile(pluginCode, childPath, rootGrantId) };
                    }) };
                    break;
                }

                case 'createGrantedDirectory': {
                    const path = await resolveGrantedOutputPath(pluginCode, data.directory?.id, data.name);
                    if (!path) { result = await deniedDirectoryAccess(pluginCode, action, data.directory?.id, data.name); break; }
                    await mkdir(path, { recursive: false });
                    result = { ok: true, value: fileGrants.grantDirectory(pluginCode, path, fileGrants.getDirectoryGrant(pluginCode, data.directory.id)?.rootGrantId) };
                    break;
                }

                case 'removeGrantedDirectory': {
                    const root = await resolveGrantedDirectory(pluginCode, data.directory?.id);
                    const path = data.name ? await resolveGrantedOutputPath(pluginCode, data.directory?.id, data.name) : root;
                    if (!path) { result = await deniedDirectoryAccess(pluginCode, action, data.directory?.id, data.name); break; }
                    await invoke('move_to_trash', { path });
                    result = { ok: true, value: undefined };
                    break;
                }

                // ── V2 文件选择与引用操作 ─────────────────────
                case 'openDialog': {
                    const selected = await open({
                        directory: data.kind === 'directory',
                        multiple: data.multiple ?? false,
                        filters: data.filters,
                        title: data.title,
                    });
                    if (!selected) {
                        result = { ok: false, error: { code: 'CANCELLED', message: '用户取消选择' } };
                        break;
                    }
                    if (data.kind === 'directory') {
                        result = { ok: true, value: fileGrants.grantDirectory(pluginCode, selected as string) };
                    } else {
                        const paths = Array.isArray(selected) ? selected : [selected];
                        result = { ok: true, value: paths.map(path => fileGrants.grantFile(pluginCode, path)) };
                    }
                    break;
                }

                case 'saveDialog': {
                    const initialDirectory = data.initialDirectory?.id && await resolveGrantedDirectory(pluginCode, data.initialDirectory.id);
                    const selected = await save({
                        title: data.title,
                        filters: data.filters,
                        defaultPath: initialDirectory ? `${initialDirectory.replace(/[\\/]+$/, '')}/${data.defaultFileName}` : data.defaultFileName,
                        canCreateDirectories: true,
                    });
                    if (!selected) {
                        result = { ok: false, error: { code: 'CANCELLED', message: '用户取消保存' } };
                        break;
                    }
                    result = { ok: true, value: fileGrants.grantWritableFile(pluginCode, selected) };
                    break;
                }

                case 'readGrantedFile': {
                    const path = await resolveGrantedFile(pluginCode, data.fileId);
                    if (!path) {
                        result = await deniedFileAccess(pluginCode, action, data.fileId);
                        break;
                    }
                    const bytes = await readFile(path);
                    result = bytes.byteLength > MAX_FILE_BYTES
                        ? { ok: false, error: { code: 'FILE_TOO_LARGE', message: `单个文件不能超过 ${MAX_FILE_BYTES} 字节` } }
                        : { ok: true, value: bytes };
                    break;
                }

                case 'writeGrantedFile': {
                    const rootGrantId = data.directoryId ? fileGrants.getDirectoryGrant(pluginCode, data.directoryId)?.rootGrantId : undefined;
                    const path = data.fileId
                        ? fileGrants.resolveWritableFile(pluginCode, data.fileId)
                        : await resolveGrantedOutputPath(pluginCode, data.directoryId, data.fileName);
                    if (!path) {
                        result = data.fileId
                            ? await deniedFileAccess(pluginCode, action, data.fileId)
                            : await deniedDirectoryAccess(pluginCode, action, data.directoryId, data.fileName);
                        break;
                    }
                    if (data.bytes.length > MAX_FILE_BYTES) { result = { ok: false, error: { code: 'FILE_TOO_LARGE', message: `单个文件不能超过 ${MAX_FILE_BYTES} 字节` } }; break; }
                    // Ensure a directory reference that was just created or restored
                    // is materialized before creating the child file.
                    await mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true });
                    await writeFile(path, new Uint8Array(data.bytes));
                    result = { ok: true, value: fileGrants.grantFile(pluginCode, path, rootGrantId) };
                    break;
                }

                case 'getSettings': {
                    result = await getSettingsByPluginCode(pluginCode);
                    if (result?.code === 1 && Array.isArray(result.data)) result.data = result.data.filter((setting: any) => setting.param_type !== 'dir');
                    break;
                }

                case 'saveSetting': {
                    result = await saveSettingsByPluginCode(pluginCode, data.settings);
                    break;
                }

                // ── 按 key 读取单个配置 ────────────────────────
                case 'getSettingByKey': {
                    const { paramKey } = data;
                    result = await getSettingByKey(pluginCode, paramKey);
                    if (result?.code === 1 && result.data?.param_type === 'dir') result = { ok: false, error: { code: 'PERMISSION_DENIED', message: '目录设置仅能通过目录授权接口读取' } };
                    break;
                }

                // ── 按 key 保存单个配置（不存在则插入） ────────
                case 'saveSettingByKey': {
                    const { paramKey, paramValue } = data;
                    result = paramKey === 'storage_dir'
                        ? { ok: false, error: { code: 'PERMISSION_DENIED', message: '目录设置仅能通过目录授权接口更新' } }
                        : await upsertSettingByKey(pluginCode, paramKey, paramValue);
                    break;
                }

                case 'grantDirectory': {
                    const path = await resolveGrantedDirectory(pluginCode, data.directory?.id);
                    if (!path) { result = await deniedDirectoryAccess(pluginCode, action, data.directory?.id); break; }
                    result = await grantPluginDirectoryPermission(pluginCode, data.permissionKey, data.directory.id, path, data.directory.name);
                    if (result?.code === 1) {
                        const grant = result.data;
                        result = {
                            ok: true,
                            value: fileGrants.restoreDirectory(pluginCode, grant.grant_id, grant.resource_locator, grant.resource_display_name),
                        };
                    }
                    break;
                }

                case 'getGrantedDirectory': {
                    const storageDirectory = await getPluginDirectoryPermission(pluginCode, data.permissionKey);
                    if (storageDirectory.code !== 1) { result = storageDirectory; break; }
                    const record = storageDirectory.data;
                    result = { ok: true, value: fileGrants.restoreDirectory(pluginCode, record.grant_id, record.resource_locator, record.resource_display_name) };
                    break;
                }

                case 'revokeDirectory': {
                    const revoked = await revokePluginDirectoryPermission(pluginCode, data.permissionKey);
                    if (revoked.code !== 1) { result = revoked; break; }
                    fileGrants.revokeDirectory(pluginCode, revoked.data.grant_id);
                    result = { ok: true, value: undefined };
                    break;
                }

                // ── 插件菜单注册 ───────────────────────────────
                // 插件 mounted 时调用，注册菜单描述到 menuRegistry，
                // menuVersion 递增触发 frame 组件 watch 重建窗口菜单
                case 'registerMenu': {
                    const { reg } = data;
                    useMenuRegistry().register(pluginCode, reg);
                    result = { code: 1 };
                    break;
                }

                // ── 插件菜单注销 ───────────────────────────────
                // 插件 beforeUnmount 时调用，清理菜单注册
                case 'unregisterMenu': {
                    const { menuId } = data;
                    useMenuRegistry().unregister(pluginCode, menuId);
                    result = { code: 1 };
                    break;
                }

                // ── 日志写入 ────────────────────────────────
                case 'log': {
                    const { level, category, message, details } = data;
                    await logEvent(level || 'info', category, message, details);
                    result = { code: 1 };
                    break;
                }

                // ── 发送系统通知 ─────────────────────────────
                case 'sendNotification': {
                    const { title, body, sound } = data;
                    try {
                        const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
                        let granted = await isPermissionGranted();
                        if (!granted) {
                            const permission = await requestPermission();
                            granted = permission === 'granted';
                        }
                        if (granted) {
                            sendNotification({ title, body, sound: sound || 'default' });
                            result = { code: 1 };
                        } else {
                            result = { code: 0, msg: '通知权限未授予' };
                        }
                    } catch (e: any) {
                        result = { code: 0, msg: e.message };
                    }
                    break;
                }

                // ── 未知操作 ───────────────────────────────────
                default:
                    result = { code: 0, msg: `未知操作: ${action}` };
            }

            // 记录审计日志
            const cost = performance.now() - start;
            const outcome = result?.ok === true ? 1 : result?.ok === false ? 0 : result?.code ?? 'error';
            await logEvent('debug', 'bridge', `${action} ${outcome}`, {
                pluginCode,
                action,
                code: outcome,
                cost_ms: Math.round(cost),
            });
            
            sendResponse(source, origin, requestId, result, operation);
        } catch (e: unknown) {
            // 全局异常捕获，防止未捕获异常导致插件无响应
            const message = errorMessage(e);
            try {
                await logEvent('error', 'bridge', `${action ?? operation ?? 'unknown'} failed`, {
                    pluginCode,
                    action,
                    operation,
                    error: message,
                });
            } catch { /* error reporting must not prevent the bridge response */ }
            sendResponse(source, origin, requestId, { code: 0, msg: message }, operation);
        }
    });
}

function isPlainFileName(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value) && value !== '.' && value !== '..'
        && !value.includes('/') && !value.includes('\\');
}

/**
 * The cache accelerates normal calls, while `access_grant` is the durable
 * authority for selected root directories. This makes a bridge/HMR restart
 * transparent without allowing arbitrary plugin paths.
 */
async function resolveGrantedDirectory(pluginCode: string, directoryId: unknown): Promise<string | undefined> {
    if (typeof directoryId !== 'string') return undefined;
    const cached = fileGrants.getDirectoryGrant(pluginCode, directoryId);
    if (cached) {
        // A listed/created child (for example `.assets`) is not a second
        // authorization. It remains usable only while its selected root grant
        // is active for the same plugin.
        // A directory just selected in a system dialog is scoped to this
        // bridge session. It becomes durable only after permissions.grantDirectory.
        if (!cached.rootGrantId) return cached.path;
        const root = await getDirectoryAccessGrant(pluginCode, cached.rootGrantId);
        return root.code === 1 && root.data && isPathWithinGrantedRoot(cached.path, root.data.resource_locator)
            ? cached.path
            : undefined;
    }
    // Only a durable root grant can be restored after the bridge cache is
    // recreated. A child reference deliberately expires with that cache.
    const grant = await getDirectoryAccessGrant(pluginCode, directoryId);
    if (grant.code !== 1 || !grant.data) return undefined;
    const record = grant.data;
    fileGrants.restoreDirectory(pluginCode, record.grant_id, record.resource_locator, record.resource_display_name);
    return record.resource_locator;
}

async function resolveGrantedFile(pluginCode: string, fileId: unknown): Promise<string | undefined> {
    if (typeof fileId !== 'string') return undefined;
    const file = fileGrants.getFileGrant(pluginCode, fileId);
    if (!file || file.access !== 'read') return undefined;
    if (!file.rootGrantId) return file.path; // a file explicitly selected by the user
    const root = await getDirectoryAccessGrant(pluginCode, file.rootGrantId);
    return root.code === 1 && root.data && isPathWithinGrantedRoot(file.path, root.data.resource_locator)
        ? file.path
        : undefined;
}

async function deniedDirectoryAccess(pluginCode: string, action: string, directoryId: unknown, fileName?: unknown) {
    const invalidName = fileName !== undefined && !isPlainFileName(fileName);
    const error = invalidName
        ? { code: 'INVALID_FILE_NAME', message: '文件或目录名称无效' }
        : { code: 'GRANT_NOT_FOUND', message: '目录授权不存在、已撤销或引用已过期' };
    await logEvent('warn', 'bridge', 'directory access denied', {
        pluginCode, action, directoryId: typeof directoryId === 'string' ? directoryId : undefined,
        reason: error.code,
    });
    return { ok: false, error };
}

async function deniedFileAccess(pluginCode: string, action: string, fileId: unknown) {
    const error = { code: 'REFERENCE_EXPIRED', message: '文件引用已过期、无写权限或所属目录授权已失效' };
    await logEvent('warn', 'bridge', 'file access denied', {
        pluginCode, action, fileId: typeof fileId === 'string' ? fileId : undefined,
        reason: error.code,
    });
    return { ok: false, error };
}

async function resolveGrantedOutputPath(pluginCode: string, directoryId: unknown, fileName: unknown): Promise<string | undefined> {
    if (!isPlainFileName(fileName)) return undefined;
    const directory = await resolveGrantedDirectory(pluginCode, directoryId);
    return directory ? `${directory.replace(/[\\/]+$/, '')}/${fileName}` : undefined;
}

/**
 * 宿主→插件反向事件发送
 *
 * 当用户点击 Tauri 原生窗口菜单时，由菜单项的 action 闭包调用此函数，
 * 通过 postMessage 将菜单事件回传给对应的插件 iframe。
 *
 * 安全策略：
 *   - 仅当该插件是当前活跃 tab 时才发送，防止事件误投
 *   - 通过 iframe[data-treasure-plugin] 属性定位目标 iframe
 *
 * @param pluginCode - 目标插件编码
 * @param menuId     - 菜单 ID（对应 MenuRegistration.menuId）
 * @param itemId     - 菜单项 ID（对应 MenuItemDef.id）
 */
export function dispatchMenuEvent(pluginCode: string, menuId: string, itemId: string) {
    // 仅发送给当前活跃标签页的插件，避免事件误投到后台插件
    if (useTabsStore().activePluginCode !== pluginCode) return;
    const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-treasure-plugin="${pluginCode}"]`);
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: 'treasure-menu-event', menuId, itemId }, '*');
}
