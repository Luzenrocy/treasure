/**
 * @file 插件桥接层 —— 宿主侧的 postMessage 监听与 action 分发核心
 *
 * 职责：
 *   1. 监听来自插件 iframe 的 `treasure-db-request` 消息
 *   2. 按 action 字符串分发到对应处理函数
 *   3. 执行安全校验、SQL 重写、Tauri API 调用
 *   4. 将结果通过 `treasure-db-response` 回传给插件
 *
 * 通信协议：
 *   - 请求格式  → SDK-HOST.md 2.1 节
 *   - 响应格式  → SDK-HOST.md 2.2 节
 *   - Action 表 → SDK-HOST.md 第三章
 *
 * 安全校验链路：
 *   ① origin 白名单校验（仅允许 plugin://localhost 和 http://localhost）
 *   ② verify_sql（Rust 命令）— 检查 SQL 中引用的表是否在 declaredTables 中声明
 *   ③ rewriteWithDeclaredTables — 将裸表名重写为 "plugin_{pluginCode}_{table}"
 *   ④ PluginSqlExecutor.executeRequest — SQL 安全规则校验 + 执行
 *
 * @packageDocumentation
 */

import { PluginSqlExecutor } from './pluginSqlExecutor';
import { readTextFile, writeTextFile, mkdir, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getSettingsByPluginCode, saveSettingsByPluginCode, getSettingByKey, upsertSettingByKey } from '@/sql/platformService';
import { rewriteWithDeclaredTables } from './sqlRewriter';
import { useMenuRegistry } from '@/store/menuRegistry';
import { useTabsStore } from '@/store/tabs';
import { logEvent } from '@/utils/logger';

/** 插件 SQL 安全执行器（全局单例） */
let executor: PluginSqlExecutor;

/**
 * 向插件 iframe 发送响应消息
 *
 * @param source    - postMessage 的来源窗口对象（event.source）
 * @param origin    - 目标 origin（与插件 iframe 一致）
 * @param requestId - 请求唯一 ID（对应插件端的 PendingRequest）
 * @param data      - 响应数据（包含 code, msg, data 等字段）
 */
async function sendResponse(source: Window, origin: string, requestId: string, data: any) {
    source.postMessage(
        { type: 'treasure-db-response', requestId, ...data },
        { targetOrigin: origin }
    );
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
        // 仅允许插件 iframe 的源（plugin://localhost 或 http://localhost）
        // 注意：plugin://localhost 协议在某些情况下 event.origin 可能为 null
        const validOrigins = ['plugin://localhost', 'http://localhost'];
        const origin = event.origin || (event as any).originalEvent?.origin;

        await logEvent('debug', 'bridge', 'message received', { origin, action: event.data?.action });

        const originValid = origin === null || validOrigins.some(o => origin?.startsWith(o));
        if (!originValid) return;

        // ── 第 2 步：消息格式校验 ──────────────────────────────
        const data = event.data;
        if (!data || data.type !== 'treasure-db-request') return;

        const { requestId, pluginCode, action } = data;
        const source = event.source as Window;

        if (!pluginCode || !action) {
            sendResponse(source, origin, requestId, { code: 0, msg: '缺少必要参数' });
            return;
        }

        // ── 第 3 步：action 分发与执行 ─────────────────────────
        try {
            const start = performance.now();
            let result: any;

            switch (action) {
                // ── SQL 查询 / 写操作 ───────────────────────────
                // 流程：verify_sql(Rust) → rewriteWithDeclaredTables → PluginSqlExecutor
                case 'query':
                case 'execute': {
                    const { sql, tables, params } = data;
                    // ① Rust 级 SQL 验证：检查 SQL 中引用的表是否在声明列表中
                    const vr: any = await invoke('verify_sql', { sql, declaredTables: tables || [] });
                    if (!vr.ok) {
                        result = { code: 0, msg: `声明验证失败: ${vr.missing?.length ? '漏声明: ' + vr.missing.join(', ') : ''}` };
                        break;
                    }
                    // ② 表名重写：bare table → "plugin_{pluginCode}_{table}"
                    const rewritten = rewriteWithDeclaredTables(sql, tables || [], pluginCode);
                    // ③ 安全校验 + 执行
                    result = await executor.executeRequest(pluginCode, action, rewritten, params);
                    break;
                }

                // ── SQL 事务 ──────────────────────────────────
                // 逐条验证 → 逐条重写 → 批量执行
                case 'transaction': {
                    const { ops } = data;
                    let failed = false;
                    // 逐条验证每一条 SQL 的表声明
                    for (const op of ops) {
                        const vr: any = await invoke('verify_sql', { sql: op.sql, declaredTables: op.tables || [] });
                        if (!vr.ok) {
                            result = { code: 0, msg: `事务SQL声明验证失败: ${vr.missing?.length ? '漏声明: ' + vr.missing.join(', ') : ''}` };
                            failed = true;
                            break;
                        }
                    }
                    if (!failed) {
                        const rewrittenOps = ops.map((op: any) => ({
                            sql: rewriteWithDeclaredTables(op.sql, op.tables || [], pluginCode),
                            params: op.params,
                        }));
                        result = await executor.executeRequest(pluginCode, 'transaction', '', rewrittenOps);
                    }
                    break;
                }

                // ── 获取插件数据目录绝对路径 ──────────────────
                case 'getPluginDataDir': {
                    try {
                        const { appDataDir } = await import('@tauri-apps/api/path');
                        const appDataPath = await appDataDir();
                        const pluginDir = `${appDataPath}/plugin/${pluginCode}`;
                        result = { code: 1, data: pluginDir };
                    } catch (e: any) {
                        result = { code: 0, msg: e.message };
                    }
                    break;
                }

                // ── 获取插件数据目录绝对路径 ──────────────────
                case 'getPluginDataDir': {
                    try {
                        const { appDataDir } = await import('@tauri-apps/api/path');
                        const appDataPath = await appDataDir();
                        const pluginDir = `${appDataPath}/plugin/${pluginCode}`;
                        result = { code: 1, data: pluginDir };
                    } catch (e: any) {
                        result = { code: 0, msg: e.message };
                    }
                    break;
                }

                // ── 文本文件读取 ──────────────────────────────
                case 'readFile': {
                    const content = await readTextFile(data.path);
                    result = { code: 1, data: content };
                    break;
                }

                // ── 二进制文件读取（返回 base64） ─────────────
                // 将 Uint8Array 逐个字节转为字符后 base64 编码
                case 'readBinaryFile': {
                    if (!data.path) {
                        result = { code: 0, msg: '缺少 path 参数' };
                        break;
                    }
                    const bytes = await readFile(data.path);
                    let binary = '';
                    for (const byte of bytes) binary += String.fromCharCode(byte);
                    result = { code: 1, data: btoa(binary) };
                    break;
                }

                // ── 列出目录内容 ──────────────────────────────
                case 'readDir': {
                    const entries = await readDir(data.path);
                    result = {
                        code: 1,
                        data: entries.map(entry => ({
                            name: entry.name,
                            path: `${data.path}/${entry.name}`,
                            isDirectory: entry.isDirectory,
                            isFile: entry.isFile,
                        })),
                    };
                    break;
                }

                // ── 文件写入（createFile / updateFile / writeFile 共用） ──
                case 'createFile':
                case 'updateFile':
                case 'writeFile': {
                    if (!data.path) {
                        result = { code: 0, msg: '缺少 path 参数' };
                        break;
                    }
                    await writeTextFile(data.path, data.content ?? '');
                    result = { code: 1 };
                    break;
                }

                // ── 二进制文件写入（base64 → Uint8Array → writeFile） ──
                case 'writeBinaryFile': {
                    if (!data.path) {
                        result = { code: 0, msg: '缺少 path 参数' };
                        break;
                    }
                    if (!data.content) {
                        result = { code: 0, msg: '缺少 content 参数' };
                        break;
                    }
                    const binary = atob(data.content);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    await writeFile(data.path, bytes);
                    result = { code: 1 };
                    break;
                }

                // ── 创建目录（createDir / mkdir 兼容两种命名） ──
                case 'createDir':
                case 'mkdir': {
                    if (!data.path) {
                        result = { code: 0, msg: '缺少 path 参数' };
                        break;
                    }
                    await mkdir(data.path, { recursive: data.recursive ?? true });
                    result = { code: 1 };
                    break;
                }

                // ── 删除文件 / 目录（移到回收站，非永久删除） ──
                case 'deleteFile':
                case 'deleteDir': {
                    if (!data.path) {
                        result = { code: 0, msg: '缺少 path 参数' };
                        break;
                    }
                    await invoke('move_to_trash', { path: data.path });
                    result = { code: 1 };
                    break;
                }

                // ── 目录选择对话框 ─────────────────────────────
                case 'selectDirectory': {
                    const selected = await open({ directory: true, multiple: false, title: data.title });
                    result = { code: 1, data: selected };
                    break;
                }

                // ── 文件保存对话框 ─────────────────────────────
                case 'saveDialog': {
                    const filePath = await save({ defaultPath: data.defaultPath, filters: data.filters });
                    result = { code: 1, data: filePath };
                    break;
                }

                // ── 二进制文件保存（base64 → Uint8Array → 保存对话框） ──
                case 'saveBinaryFile': {
                    const filePath = await save({ defaultPath: data.defaultPath, filters: data.filters });
                    if (!filePath) {
                        result = { code: 0, msg: '用户取消保存' };
                        break;
                    }
                    const binary = atob(data.content);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    await writeFile(filePath, bytes);
                    result = { code: 1, data: filePath };
                    break;
                }

                // ── 配置读取（getSettings / getMySettings 兼容别名） ──
                case 'getSettings':
                case 'getMySettings': {
                    result = await getSettingsByPluginCode(pluginCode);
                    break;
                }

                // ── 配置保存（saveSetting / saveMySetting 兼容别名） ──
                case 'saveSetting':
                case 'saveMySetting': {
                    result = await saveSettingsByPluginCode(pluginCode, data.settings);
                    break;
                }

                // ── 按 key 读取单个配置 ────────────────────────
                case 'getSettingByKey': {
                    const { paramKey } = data;
                    result = await getSettingByKey(pluginCode, paramKey);
                    break;
                }

                // ── 按 key 保存单个配置（不存在则插入） ────────
                case 'saveSettingByKey': {
                    const { paramKey, paramValue } = data;
                    result = await upsertSettingByKey(pluginCode, paramKey, paramValue);
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

                // ── 更新菜单项勾选状态 ─────────────────────────
                // 同时更新注册表，确保下次菜单重建时使用正确的 checked 状态
                case 'updateMenuState': {
                    const { menuId: mId, itemId, checked } = data;
                    const reg = useMenuRegistry();
                    await reg.updateState(pluginCode, mId, itemId, checked);
                    reg.updateRegistrationChecked(pluginCode, mId, itemId, checked);
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
            await logEvent('debug', 'bridge', `${action} ${result?.code ?? 'error'}`, {
                pluginCode,
                action,
                code: result?.code,
                cost_ms: Math.round(cost),
            });
            
            sendResponse(source, origin, requestId, result);
        } catch (e: any) {
            // 全局异常捕获，防止未捕获异常导致插件无响应
            sendResponse(source, origin, requestId, { code: 0, msg: e.message });
        }
    });
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