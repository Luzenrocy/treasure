import { query, execute, transaction, buildBatchDeleteSql } from '@/sql/common';
import { readonlyTransaction, normalizeError } from '@/sql/dbClient';
import { Response } from '@/class';

export const PLUGIN_TYPE_NORMAL = 0;
export const PLUGIN_TYPE_DEBUG = 1;

export async function getDebugSwitchEnabled(): Promise<boolean> {
    const res = await query(`SELECT param_value FROM tp_setting WHERE param_code = 'treasure::debug_switch'`);
    return res.code === 1 && res.data[0]?.param_value === '1';
}

export async function getMenus(): Promise<Response> {
    try {
        // Step 1: 查询 debug 开关（readonlyTransaction SQL 数组模式）
        const debugRows = await readonlyTransaction([
            { sql: `SELECT param_value FROM tp_setting WHERE param_code = 'treasure::debug_switch'`, params: [] },
        ]);
        const debugEnabled = debugRows[0]?.param_value === '1';

        // Step 2: 构建菜单 SQL，提交同一只读事务执行
        let sql = `
        SELECT tm.id, tm.menu_id, tm.menu_name, tm.menu_type, tm.menu_level, tm.parent_id,
               tm.menu_path, tm.menu_icon, tm.show_type, tm.show_order, tm.hidden, tm.plugin_id,
               tm.created_at, tm.updated_at,
               tp.plugin_type, tp.debug_url
        FROM tp_menu tm
        LEFT JOIN tp_plugin tp ON tm.plugin_id = tp.id
        WHERE tm.hidden = 0`;
        if (!debugEnabled) {
            sql += ` AND (tp.plugin_type IS NULL OR tp.plugin_type = 0)`;
        }
        sql += ` ORDER BY tm.menu_level, tm.show_order DESC`;
        const data = await readonlyTransaction([{ sql }]);
        return Response.ok(data);
    } catch (e) {
        return Response.error(normalizeError(e));
    }
}

export async function getPlugins(): Promise<Response> {
    const debugEnabled = await getDebugSwitchEnabled();
    let sql = `
        SELECT tp.*, tm.menu_id, tm.menu_icon, tm.hidden as menu_hidden
        FROM tp_plugin tp
        LEFT JOIN tp_menu tm ON tp.id = tm.plugin_id
        WHERE tp.plugin_code != 'treasure'
    `;
    if (!debugEnabled) {
        sql += ` AND tp.plugin_type = 0`;
    }
    sql += ` ORDER BY tp.created_at DESC`;
    return query(sql);
}

export async function getPluginByCode(pluginCode: string): Promise<Response> {
    const sql = `SELECT * FROM tp_plugin WHERE plugin_code = ?`;
    const res = await query(sql, [pluginCode]);
    if (res.code === 1 && res.data.length > 0) {
        return Response.ok(res.data[0]);
    }
    return Response.errorNotFound('插件不存在');
}

export async function isPluginCodeExists(pluginCode: string): Promise<Response> {
    const sql = `SELECT COUNT(*) as count FROM tp_plugin WHERE plugin_code = ?`;
    const res = await query(sql, [pluginCode]);
    if (res.code === 1) {
        return Response.ok((res.data[0]?.count || 0) > 0);
    }
    return Response.error('检查失败');
}

export async function deletePluginById(pluginId: number): Promise<Response> {
    const plugin = await query('SELECT plugin_code FROM tp_plugin WHERE id = ?', [pluginId]);
    if (plugin.code === 1 && plugin.data[0]?.plugin_code === 'treasure') {
        return Response.errorPermission('禁止删除系统参数插件');
    }

    // 清理插件数据表（调试插件同样需要清理 manifest 创建的表）
    if (plugin.code === 1 && plugin.data[0]?.plugin_code) {
        await execDestroyScript(plugin.data[0].plugin_code);
        await cleanupPluginTables(plugin.data[0].plugin_code);
    }

    const sqls = [
        { sql: 'DELETE FROM tp_setting WHERE plugin_id = ?' },
        { sql: 'DELETE FROM tp_menu WHERE plugin_id = ?' },
        { sql: 'DELETE FROM tp_plugin WHERE id = ?' },
    ];
    return transaction(sqls.map(s => ({ ...s, params: [pluginId] })));
}

export async function batchDeletePlugins(pluginIds: number[]): Promise<Response> {
    if (pluginIds.length === 0) return Response.ok({ deleted: 0 });
    for (const id of pluginIds) {
        const plugin = await query('SELECT plugin_code FROM tp_plugin WHERE id = ?', [id]);
        if (plugin.code === 1 && plugin.data[0]?.plugin_code) {
            await execDestroyScript(plugin.data[0].plugin_code);
            await cleanupPluginTables(plugin.data[0].plugin_code);
        }
    }
    return transaction([
        buildBatchDeleteSql('tp_setting', 'plugin_id', pluginIds),
        buildBatchDeleteSql('tp_menu', 'plugin_id', pluginIds),
        buildBatchDeleteSql('tp_plugin', 'id', pluginIds),
    ]);
}

export async function getPluginSettings(pluginId: number): Promise<Response> {
    const sql = `
        SELECT ts.*, tp.plugin_alias
        FROM tp_setting ts
        LEFT JOIN tp_plugin tp ON ts.plugin_id = tp.id
        WHERE ts.plugin_id = ?
        ORDER BY ts.param_name
    `;
    return query(sql, [pluginId]);
}

export async function getAllSettings(): Promise<Response> {
    const sql = `
        SELECT ts.*, tp.plugin_alias
        FROM tp_setting ts
        LEFT JOIN tp_plugin tp ON ts.plugin_id = tp.id
        ORDER BY tp.plugin_alias
    `;
    return query(sql);
}

const PLUGIN_CENTER_MENU_ID = '100002';
const MENU_SHOW_VALUE = '1';

function normalizeSwitchValue(raw: any): string {
    if (raw === true || raw === 1 || raw === '1' || raw === 'true') return '1';
    return '0';
}

export async function saveSettings(settings: Array<{ id: number; param_value: any; param_type?: string; param_code?: string; menu_id?: string }>): Promise<Response> {
    const invalid = settings.find(s => !Number.isFinite(Number(s.id)));
    if (invalid) {
        return Response.errorParam('存在无效配置项：缺少配置 id');
    }

    const now = Date.now();
    const sqls: Array<{ sql: string; params: any[] }> = [];
    for (const s of settings) {
        const isSwitch = s.param_type === 'switch';
        const value = isSwitch ? normalizeSwitchValue(s.param_value) : String(s.param_value ?? '');
        sqls.push({ sql: 'UPDATE tp_setting SET param_value = ?, updated_at = ? WHERE id = ?', params: [value, now, Number(s.id)] });
        if (s.param_code === 'treasure::plugin_manager_switch') {
            const menuHidden = value === MENU_SHOW_VALUE ? 0 : 1;
            sqls.push({ sql: 'UPDATE tp_menu SET hidden = ?, updated_at = ? WHERE menu_id = ?', params: [menuHidden, now, PLUGIN_CENTER_MENU_ID] });
        }
    }

    if (sqls.length === 0) return Response.ok({ updated: 0 });
    return transaction(sqls);
}

export async function getLogSettings(): Promise<{
  retention_days: number;
  level: string;
  db_enabled: boolean;
  biz_enabled: boolean;
  sys_enabled: boolean;
}> {
  const res = await query(`
    SELECT param_key, param_value FROM tp_setting 
    WHERE param_code LIKE 'treasure::log_%'
  `);
  if (res.code !== 1) {
    return {
      retention_days: 6,
      level: 'info',
      db_enabled: false,
      biz_enabled: false,
      sys_enabled: false,
    };
  }
  const map = new Map(res.data.map((r: any) => [r.param_key, r.param_value]));
  return {
    retention_days: Number(map.get('log_retention_days') || 6),
    level: String(map.get('log_level') || 'info'),
    db_enabled: map.get('log_db_enabled') !== '0',
    biz_enabled: map.get('log_biz_enabled') !== '0',
    sys_enabled: map.get('log_sys_enabled') !== '0',
  };
}

interface ManifestSetting {
    param_key: string;
    param_name: string;
    param_type: string;
    param_value?: string;
    param_placeholder?: string;
    param_properties?: string;
    param_options?: string;
    menu_id?: string;
}

const SUPPORTED_PARAM_TYPES = ['input', 'number', 'switch', 'dir', 'select', 'checkbox', 'radio', 'time'];
const RESERVED_PLUGIN_CODES = ['treasure', '_debug_'];

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.ico', '.webp', '.gif']);

/**
 * 校验图标引用字符串
 * @param iconRef 图标引用
 * @param fieldName 字段名（用于错误提示）
 * @returns 错误列表
 */
export function validateIconRef(iconRef: any, fieldName: string = 'icon'): string[] {
  const errors: string[] = [];

  if (!iconRef || typeof iconRef !== 'string') {
    return errors; // 空值由必填校验控制
  }

  const trimmed = iconRef.trim();

  // 空字符串有效（使用默认图标）
  if (trimmed === '') {
    return errors;
  }

  // 预设图标名：仅允许字母、数字、下划线、短横线，且首字母大写
  if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed)) {
    return errors;
  }

  // 相对路径或 URL
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    /^https?:\/\//i.test(trimmed) ||
    /^[a-zA-Z0-9_\-./]+\.[a-z0-9]+$/i.test(trimmed)
  ) {
    // 检查扩展名
    const ext = trimmed.toLowerCase().split('.').pop() || '';
    if (!IMAGE_EXTENSIONS.has('.' + ext)) {
      errors.push(`${fieldName} 路径必须以图片扩展名结尾（支持：${[...IMAGE_EXTENSIONS].join(', ')}）`);
    }

    // 检查是否包含路径遍历
    if (trimmed.includes('..')) {
      errors.push(`${fieldName} 路径不能包含 ".."`);
    }

    return errors;
  }

  // 其他格式视为无效
  errors.push(`${fieldName} 格式无效：${trimmed}。支持预设图标名（如 "Document"）、相对路径（如 "assets/icon.svg"）或 URL`);

  return errors;
}

export function validateManifest(manifest: any): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.name) errors.push('缺少必填字段: name');
    if (!manifest.alias) errors.push('缺少必填字段: alias');
    if (!manifest.version) errors.push('缺少必填字段: version');
    if (!manifest.entry) errors.push('缺少必填字段: entry');
    if (!manifest.menu?.name) errors.push('缺少必填字段: menu.name');

    if (manifest.name && !/^[a-z][a-z0-9-]*$/.test(manifest.name)) {
        errors.push('name 必须为 kebab-case 格式（小写字母、数字、短横线）');
    }

    if (RESERVED_PLUGIN_CODES.includes(manifest.name)) {
        errors.push(`name 不能使用保留名: ${RESERVED_PLUGIN_CODES.join(', ')}`);
    }

    if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        errors.push('version 必须为 semver 格式（如 1.0.0）');
    }

    // ── 图标字段校验 ────────────────────────────────────────
    if (manifest.icon !== undefined) {
        const iconErrors = validateIconRef(manifest.icon, 'icon');
        errors.push(...iconErrors);
    }

    // menu.icon 同样支持自定义路径
    if (manifest.menu?.icon !== undefined) {
        const menuIconErrors = validateIconRef(manifest.menu.icon, 'menu.icon');
        errors.push(...menuIconErrors);
    }

    if (manifest.settings) {
        for (const s of manifest.settings) {
            if (!SUPPORTED_PARAM_TYPES.includes(s.param_type)) {
                errors.push(`不支持的 param_type: ${s.param_type}（支持: ${SUPPORTED_PARAM_TYPES.join(', ')}）`);
            }
            if (!s.param_key) {
                errors.push('settings 缺少必填字段: param_key');
                continue;
            }
            if (!/^[a-z][a-z0-9_-]*$/.test(s.param_key)) {
                errors.push('param_key 必须为小写字母/数字/下划线/短横线组合');
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

export async function cleanupPluginTables(pluginCode: string): Promise<void> {
    const prefix = `plugin_${pluginCode}_`;
    const res = await query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ?", [prefix + '%']);
    if (res.code !== 1) return;
    const tables = res.data as { name: string }[];
    if (tables.length === 0) return;

    // 临时关闭外键约束，避免因 DROP 顺序（子表先于父表）导致失败
    await execute("PRAGMA foreign_keys = OFF", []);
    try {
        for (const t of tables) {
            await execute(`DROP TABLE IF EXISTS "${t.name}"`);
        }
        const idxRes = await query(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE ? AND name NOT LIKE 'sqlite_%'",
            [prefix + '%']
        );
        if (idxRes.code === 1) {
            const indexes = idxRes.data as { name: string }[];
            for (const idx of indexes) {
                await execute(`DROP INDEX IF EXISTS "${idx.name}"`);
            }
        }
    } finally {
        await execute("PRAGMA foreign_keys = ON", []);
    }
}

export function semverCompare(a: string, b: string): number {
    const [ma, mb] = [a, b].map(v => v.split('.').map(Number));
    for (let i = 0; i < 3; i++) {
        if (ma[i] > mb[i]) return 1;
        if (ma[i] < mb[i]) return -1;
    }
    return 0;
}

export function isNewerVersion(newVer: string, oldVer: string): boolean {
    return semverCompare(newVer, oldVer) > 0;
}

export async function upgradePlugin(pluginCode: string, manifest: any): Promise<Response> {
    const oldPlugin = await getPluginByCode(pluginCode);
    if (oldPlugin.code !== 1) return Response.errorNotFound('插件不存在');

    if (!isNewerVersion(manifest.version, oldPlugin.data.plugin_version)) {
        return Response.errorParam('新版本号必须大于当前版本');
    }

    if (manifest.minPlatformVersion) {
        const latestVer = getLatestVersionStatic();
        if (!isCompatibleVersion(manifest.minPlatformVersion, latestVer)) {
            return Response.errorParam(
                `插件要求最低平台版本 ${manifest.minPlatformVersion}，当前平台版本 ${latestVer}`
            );
        }
    }

    return transaction([
        { sql: 'UPDATE tp_plugin SET plugin_version=?, plugin_alias=?, plugin_desc=?, plugin_author=?, updated_at=? WHERE plugin_code=?',
          params: [manifest.version, manifest.alias, manifest.description, manifest.author, Date.now(), pluginCode] },
        { sql: 'UPDATE tp_menu SET menu_name=?, show_order=?, updated_at=? WHERE plugin_id=?',
          params: [manifest.menu.name, manifest.menu.order||0, Date.now(), oldPlugin.data.id] },
    ]);
}

export function isCompatibleVersion(required: string, current: number): boolean {
    const major = parseInt(required.split('.')[0]);
    return current >= major;
}

function getLatestVersionStatic(): number {
    return 5;
}

export async function createDebugPlugin({ pluginCode, pluginAlias, debugUrl, manifest, initScripts }: { pluginCode: string; pluginAlias: string; debugUrl: string; manifest?: any; initScripts?: Record<string, string> }): Promise<Response> {
    const existsRes = await isPluginCodeExists(pluginCode);
    if (existsRes.code === 1 && existsRes.data === true) {
        return Response.errorParam(`插件编码 ${pluginCode} 已存在`);
    }
    if (manifest) {
        if (manifest.name !== pluginCode) {
            return Response.errorParam(`manifest.name "${manifest.name}" 与 pluginCode "${pluginCode}" 不一致`);
        }
        const validation = validateManifest(manifest);
        if (!validation.valid) {
            return Response.errorParam(`manifest 校验失败: ${validation.errors.join('; ')}`);
        }
    }
    const now = Date.now();
    const tempUid = crypto.randomUUID();
    const pluginVersion = manifest?.version || '0.0.0';

    // 事务：tp_plugin + tp_menu 原子写入
    const txRes = await transaction([
        {
            sql: `INSERT INTO tp_plugin (plugin_code, plugin_alias, plugin_version, plugin_type, debug_url, plugin_uid, plugin_icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(plugin_code) DO UPDATE SET plugin_alias=excluded.plugin_alias, plugin_version=excluded.plugin_version, plugin_type=excluded.plugin_type, debug_url=excluded.debug_url, plugin_uid=excluded.plugin_uid, plugin_icon=excluded.plugin_icon, updated_at=excluded.updated_at`,
            params: [pluginCode, pluginAlias, pluginVersion, PLUGIN_TYPE_DEBUG, debugUrl, tempUid, manifest?.icon || '', now, now]
        },
        {
            sql: `INSERT INTO tp_menu (menu_id, menu_name, menu_type, menu_level, parent_id, menu_path, menu_icon, show_type, show_order, hidden, plugin_id, created_at, updated_at) VALUES (?, ?, 2, 1, NULL, ?, ?, 2, 0, 0, (SELECT id FROM tp_plugin WHERE plugin_code = ?), ?, ?) ON CONFLICT(menu_id) DO UPDATE SET menu_name=excluded.menu_name, menu_icon=excluded.menu_icon, updated_at=excluded.updated_at`,
            params: [`plugin_${pluginCode}`, pluginAlias, `/plugin/${pluginCode}`, manifest?.menu?.icon || '', pluginCode, now, now]
        },
    ]);
    if (txRes.code !== 1) {
        return Response.error('调试插件注册失败');
    }

    // 查询回 pluginId（用于后续资源创建）
    const pluginRes = await getPluginByCode(pluginCode);
    if (pluginRes.code !== 1) {
        return Response.error('调试插件注册后查询失败');
    }
    const pluginId = pluginRes.data.id;

    // 如果提供了 manifest，按 manifest 创建参数
    if (manifest) {
        await provisionPluginResources(pluginId, pluginCode, manifest, now);
    }

    // 下载自定义图标到 AppData（plugin:// 协议只能访问本地文件）
    if (manifest) {
        await downloadPluginIcons(pluginCode, manifest, debugUrl);
    }

    // 写入所有版本化 init 脚本到 AppData 后执行增量迁移
    if (initScripts && Object.keys(initScripts).length > 0) {
        try {
            const { appDataDir } = await import('@tauri-apps/api/path');
            const { mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
            const appDataPath = await appDataDir();
            const initDir = `${appDataPath}/plugin/${pluginCode}/scripts/init`;
            await mkdir(initDir, { recursive: true });
            for (const [version, sql] of Object.entries(initScripts)) {
                await writeTextFile(`${initDir}/${version}.sql`, sql);
            }
            await runPluginInitScripts(pluginId, pluginCode, `${appDataPath}/plugin/${pluginCode}`);
        } catch (e) {
            const msg = normalizeError(e);
            console.error(`调试插件 init 脚本执行失败: ${msg}`);
            return Response.error(`初始化数据表失败: ${msg}`);
        }
    }

    return Response.ok({ pluginId });
}

/**
 * manifest 资源创建公共函数：参数声明 + 数据表
 * 供 zip 导入与调试注册共用
 *
 * 注意：侧边栏菜单（manifest.menu）由调用方自行创建（zip 导入走 handleImport，
 * 调试注册走 createDebugPlugin），此函数不重复创建菜单。
 *
 * @param pluginId       - tp_plugin 记录 id
 * @param pluginCode     - 插件编码
 * @param manifest       - 已通过 validateManifest 校验的 manifest 对象
 * @param now            - 统一时间戳（由调用方传入以保证事务一致性）
 * @param preservedValues - 可选：保留的旧参数值（param_key → param_value），
 *                          调试→正式升级时传入，避免用户配置丢失
 */
export async function provisionPluginResources(
    pluginId: number,
    pluginCode: string,
    manifest: any,
    now: number,
    preservedValues?: Record<string, string>,
): Promise<void> {
    // 1. 参数声明（manifest.settings）
    if (manifest.settings && manifest.settings.length > 0) {
        for (const s of manifest.settings) {
            const paramKey = s.param_key; // validateManifest 已保证必填
            // 优先使用保留的旧值，其次 manifest 默认值
            const savedValue = preservedValues?.[paramKey];
            await execute(
`INSERT INTO tp_setting (param_code, param_name, param_key, param_type, param_value, param_placeholder, param_properties, param_options, plugin_id, menu_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [`${pluginCode}::${paramKey}`, s.param_name, paramKey, s.param_type, savedValue ?? s.param_value ?? '', s.param_placeholder || '', s.param_properties || null, s.param_options || null, pluginId, s.menu_id || null, now, now]
            );
        }
    }
}

export async function updatePluginMenuHidden(pluginId: number, pluginAlias: string, hidden: number): Promise<Response> {
    return transaction([
        { sql: 'UPDATE tp_menu SET hidden = ?, updated_at = ?, plugin_alias = ? WHERE plugin_id = ?', params: [hidden, Date.now(), pluginAlias, pluginId] },
    ]);
}

/**
 * 三向 diff 升级参数：以 param_key 为身份标识，保留用户已配置的 param_value 和 id。
 *
 * 逻辑：
 *   DELETE 旧有·新无（弃用参数）
 *   INSERT 旧无·新有（新增参数，用 manifest 默认值）
 *   UPDATE 旧有·新有（更新元信息，保留 param_value 和 id）
 *
 * @param pluginId    - tp_plugin 记录 id
 * @param pluginCode  - 插件编码（仅用于构建 param_code）
 * @param newSettings - 新 manifest 中的 settings 列表
 * @param now         - 统一时间戳
 * @returns { deleted, inserted, updated } 各操作计数
 */
export async function upgradePluginSettings(
    pluginId: number,
    pluginCode: string,
    newSettings: ManifestSetting[],
    now: number,
): Promise<{ deleted: number; inserted: number; updated: number }> {
    // 1. 查询当前已存 settings
    const oldRes = await query(
        'SELECT id, param_key, param_value FROM tp_setting WHERE plugin_id = ?',
        [pluginId]
    );
    const oldRows: Array<{ id: number; param_key: string; param_value: string }> = oldRes.data || [];

    // 2. 构建索引
    const oldByKey = new Map<string, { id: number; param_value: string }>();
    for (const row of oldRows) {
        if (row.param_key) oldByKey.set(row.param_key, { id: row.id, param_value: row.param_value });
    }
    const newByKey = new Map<string, ManifestSetting>();
    for (const s of (newSettings || [])) {
        if (s.param_key) newByKey.set(s.param_key, s);
    }

    let deleted = 0;
    let inserted = 0;
    let updated = 0;

    const ops: Array<{ sql: string; params: any[] }> = [];

    // 3. DELETE 旧有·新无
    for (const [key, old] of oldByKey) {
        if (!newByKey.has(key)) {
            ops.push({ sql: 'DELETE FROM tp_setting WHERE id = ?', params: [old.id] });
            deleted++;
        }
    }

    // 4. INSERT 旧无·新有
    for (const [key, new_] of newByKey) {
        if (!oldByKey.has(key)) {
            ops.push({
                sql: `INSERT INTO tp_setting (param_code, param_name, param_key, param_type, param_value, param_placeholder, param_properties, param_options, plugin_id, menu_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [
                    `${pluginCode}::${key}`,
                    new_.param_name,
                    key,
                    new_.param_type,
                    new_.param_value ?? '',
                    new_.param_placeholder || '',
                    new_.param_properties || null,
                    new_.param_options || null,
                    pluginId,
                    new_.menu_id || null,
                    now,
                    now,
                ],
            });
            inserted++;
        }
    }

    // 5. UPDATE 旧有·新有（保留 param_value 和 id）
    for (const [key, new_] of newByKey) {
        const old = oldByKey.get(key);
        if (old) {
            ops.push({
                sql: `UPDATE tp_setting SET param_name=?, param_type=?, param_placeholder=?, param_options=?, param_properties=?, updated_at=? WHERE id=?`,
                params: [
                    new_.param_name,
                    new_.param_type,
                    new_.param_placeholder || '',
                    new_.param_options || null,
                    new_.param_properties || null,
                    now,
                    old.id,
                ],
            });
            updated++;
        }
    }

    // 6. 批量执行
    if (ops.length > 0) {
        await transaction(ops);
    }
    return { deleted, inserted, updated };
}

/**
 * 逐版本执行插件 init 脚本。
 *
 * 职责范围：
 *   - 读取 {pluginDir}/scripts/init/ 目录下的 .sql 文件
 *   - 按版本号筛选出未执行过的脚本
 *   - 通过 Rust extract_tables_from_sql 提取 SQL 中的裸表名，自动重写为 plugin_{code}_ 前缀
 *   - 逐条交给 transaction 执行
 *   - 成功后在 tp_plugin_init_log 记录执行结果
 *
 * 此函数不关心 SQL 脚本的具体内容，不做任何表结构声明。
 * 完全不依赖 manifest.json 的任何字段。
 *
 * @param pluginId       - tp_plugin 记录 id
 * @param pluginCode     - 插件编码（用于表名前缀重写）
 * @param pluginDir      - 插件目录（{appData}/plugin/{pluginCode}/）
 * @returns { executed, maxVersion }
 */
export async function runPluginInitScripts(
    pluginId: number,
    pluginCode: string,
    pluginDir: string,
): Promise<{ executed: number; maxVersion: string | null }> {
    const initDir = `${pluginDir}/scripts/init`;
    let exists: (path: string) => Promise<boolean>;
    let readDir: (path: string) => Promise<Array<{ name: string }>>;
    let readTextFile: (path: string) => Promise<string>;
    try {
        const fs = await import('@tauri-apps/plugin-fs');
        exists = fs.exists;
        readDir = fs.readDir;
        readTextFile = fs.readTextFile;
    } catch {
        return { executed: 0, maxVersion: null };
    }

    if (!(await exists(initDir))) {
        console.log(`[plugin-init] ${pluginCode}: init 目录不存在: ${initDir}`);
        return { executed: 0, maxVersion: null };
    }

    const entries = await readDir(initDir);
    const sqlFiles = entries
        .filter(e => e.name.endsWith('.sql'))
        .map(e => e.name.replace(/\.sql$/, ''))
        .filter(v => /^\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => semverCompare(a, b));

    if (sqlFiles.length === 0) {
        console.log(`[plugin-init] ${pluginCode}: 未找到版本化 .sql 文件`);
        return { executed: 0, maxVersion: null };
    }

    // 查询已执行的最大版本
    const logRes = await query(
        'SELECT MAX(init_version) as maxVer FROM tp_plugin_init_log WHERE plugin_id = ? AND success = 1',
        [pluginId]
    );
    const lastVersion: string | null = logRes.data?.[0]?.maxVer || null;

    console.log(`[plugin-init] ${pluginCode}: 发现 ${sqlFiles.length} 个脚本, 已执行版本=${lastVersion || '无'}`);

    // 筛选新版本脚本
    const pending = lastVersion === null
        ? sqlFiles
        : sqlFiles.filter(v => semverCompare(v, lastVersion) > 0);

    if (pending.length === 0) {
                console.log(`[plugin-init] ${pluginCode}: 所有脚本已执行, 跳过`);
        return { executed: 0, maxVersion: lastVersion };
    }

    console.log(`[plugin-init] ${pluginCode}: 待执行版本: ${pending.join(', ')}`);

    // 逐版本执行
    const { transaction, splitSqlStatements } = await import('@/sql/common');
    const { rewriteWithDeclaredTables } = await import('@/bridge/sqlRewriter');
    const { invoke } = await import('@tauri-apps/api/core');
    let executed = 0;
    for (const version of pending) {
        const sql = await readTextFile(`${initDir}/${version}.sql`);
        const rawStatements = splitSqlStatements(sql);
        // 通过 Rust 解析 SQL 提取所有引用的裸表名，自动重写为 plugin_{pluginCode}_{table}
        const statements: string[] = [];
        for (const stmt of rawStatements) {
            const tables: string[] = await invoke('extract_tables_from_sql', { sql: stmt });
            const rewritten = rewriteWithDeclaredTables(stmt, tables, pluginCode);
            statements.push(rewritten);
        }
        try {
            const txRes = await transaction(statements.map(s => ({ sql: s })));
            if (txRes.code !== 1) {
                console.error(`[plugin-init] ${pluginCode} v${version}: 事务失败: ${txRes.msg}`);
                await execute(
                    'INSERT INTO tp_plugin_init_log (plugin_id, init_version, script_hash, executed_at, success, error_message) VALUES (?, ?, ?, ?, 0, ?)',
                    [pluginId, version, null, Date.now(), txRes.msg || '事务执行失败']
                );
                throw new Error(txRes.msg || '事务执行失败');
            }
            await execute(
                'INSERT INTO tp_plugin_init_log (plugin_id, init_version, script_hash, executed_at, success) VALUES (?, ?, ?, ?, 1)',
                [pluginId, version, null, Date.now()]
            );
            executed++;
            console.log(`[plugin-init] ${pluginCode} v${version}: 执行成功`);
        } catch (e: any) {
            console.error(`[plugin-init] ${pluginCode} v${version}: 执行失败: ${normalizeError(e)}`);
            await execute(
                'INSERT INTO tp_plugin_init_log (plugin_id, init_version, script_hash, executed_at, success, error_message) VALUES (?, ?, ?, ?, 0, ?)',
                [pluginId, version, null, Date.now(), normalizeError(e)]
            );
            throw e; // 失败向外冒泡，中止升级流程
        }
    }

    return { executed, maxVersion: pending[pending.length - 1] };
}

/**
 * 执行插件 destroy.sql 脚本。
 * 在卸载/删除插件时，在 cleanupPluginTables 之前调用。
 * 通过 Rust extract_tables_from_sql 提取裸表名并自动重写前缀。
 * 执行失败仅日志记录，不阻止后续清理流程。
 */
export async function execDestroyScript(pluginCode: string): Promise<void> {
    try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        const appDataPath = await appDataDir();
        const destroyPath = `${appDataPath}/plugin/${pluginCode}/scripts/destroy.sql`;
        const { exists, readTextFile } = await import('@tauri-apps/plugin-fs');
        if (await exists(destroyPath)) {
            const sql = await readTextFile(destroyPath);
            const { splitSqlStatements, transaction } = await import('@/sql/common');
            const { rewriteWithDeclaredTables } = await import('@/bridge/sqlRewriter');
            const { invoke } = await import('@tauri-apps/api/core');
            const rawStatements = splitSqlStatements(sql);
            const statements: string[] = [];
            for (const stmt of rawStatements) {
                const tables: string[] = await invoke('extract_tables_from_sql', { sql: stmt });
                const rewritten = rewriteWithDeclaredTables(stmt, tables, pluginCode);
                statements.push(rewritten);
            }
            if (statements.length > 0) {
                console.log(`[execDestroyScript] ${pluginCode}: 执行 DROP 事务:`, statements);
                await transaction(statements.map(s => ({ sql: s })));
            } else {
                console.warn(`[execDestroyScript] ${pluginCode}: destroy.sql 为空或无有效语句`);
            }
        }
    } catch (e) {
        console.warn(`execDestroyScript 失败（pluginCode=${pluginCode}）:`, normalizeError(e));
    }
}

export async function getPluginByUid(pluginUid: string): Promise<Response> {
    const sql = `SELECT * FROM tp_plugin WHERE plugin_uid = ?`;
    const res = await query(sql, [pluginUid]);
    if (res.code === 1 && res.data.length > 0) {
        return Response.ok(res.data[0]);
    }
    return Response.errorNotFound('插件不存在');
}

export async function getSettingsByPluginCode(pluginCode: string): Promise<Response> {
    const sql = `
        SELECT ts.*
        FROM tp_setting ts
        JOIN tp_plugin tp ON ts.plugin_id = tp.id
        WHERE tp.plugin_code = ?
        ORDER BY ts.id
    `;
    return query(sql, [pluginCode]);
}

export async function saveSettingsByPluginCode(pluginCode: string, settings: Array<{ id: number; param_value: string }>): Promise<Response> {
    const pluginRes = await getPluginByCode(pluginCode);
    if (pluginRes.code !== 1) return pluginRes;
    const pluginId = pluginRes.data.id;

    const ids = [...new Set(settings.map(s => Number(s.id)).filter(n => Number.isFinite(n)))];
    if (ids.length === 0) return Response.ok({ updated: 0 });

    const placeholders = ids.map(() => '?').join(',');
    const ownRes = await query(`SELECT COUNT(*) as count FROM tp_setting WHERE id IN (${placeholders}) AND plugin_id = ?`, [...ids, pluginId]);
    if (ownRes.code !== 1) return ownRes;
    if (ownRes.data[0].count !== ids.length) {
        return Response.errorPermission('存在不属于当前插件的配置项');
    }

    const now = Date.now();
    const sqls = settings.map(s => ({
        sql: 'UPDATE tp_setting SET param_value = ?, updated_at = ? WHERE id = ?',
        params: [s.param_value, now, Number(s.id)],
    }));
    return transaction(sqls);
}

export async function getSettingByKey(pluginCode: string, paramKey: string): Promise<Response> {
    const sql = `
        SELECT ts.* FROM tp_setting ts
        JOIN tp_plugin tp ON ts.plugin_id = tp.id
        WHERE tp.plugin_code = ? AND ts.param_key = ?
    `;
    const res = await query(sql, [pluginCode, paramKey]);
    if (res.code === 1 && res.data.length > 0) {
        return Response.ok(res.data[0]);
    }
    return Response.errorNotFound(`设置项 ${paramKey} 不存在`);
}

export async function upsertSettingByKey(pluginCode: string, paramKey: string, value: string): Promise<Response> {
    const pluginRes = await getPluginByCode(pluginCode);
    if (pluginRes.code !== 1) return pluginRes;
    const pluginId = pluginRes.data.id;
    const now = Date.now();

    const existRes = await query(
        `SELECT id FROM tp_setting WHERE plugin_id = ? AND param_key = ?`,
        [pluginId, paramKey]
    );

    if (existRes.code === 1 && existRes.data.length > 0) {
        const settingId = existRes.data[0].id;
        return execute(
            `UPDATE tp_setting SET param_value = ?, updated_at = ? WHERE id = ?`,
            [value, now, settingId]
        );
    }

    const settingKey = `${pluginCode}::${paramKey}`;
    return execute(
        `INSERT INTO tp_setting (param_code, param_name, param_key, param_type, param_value, param_placeholder, plugin_id, created_at, updated_at) 
         VALUES (?, ?, ?, 'input', ?, '', ?, ?, ?)`,
        [settingKey, paramKey, paramKey, value, pluginId, now, now]
    );
}

/**
 * 下载插件自定义图标到 AppData 目录
 *
 * 调试插件注册时，manifest 中声明的图标文件需要从 dev server 下载到本地，
 * 因为 plugin:// 协议只能访问 AppData 中的文件。
 *
 * @param pluginCode 插件编码
 * @param manifest manifest 对象
 * @param debugUrl 调试服务器地址
 */
async function downloadPluginIcons(pluginCode: string, manifest: any, debugUrl: string): Promise<void> {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');

    const appDataPath = await appDataDir();
    const pluginDir = `${appDataPath}/plugin/${pluginCode}`;
    await mkdir(pluginDir, { recursive: true });

    const baseUrl = debugUrl.replace(/\/+$/, '');

    async function downloadIcon(iconRef: string): Promise<void> {
        if (!iconRef || typeof iconRef !== 'string') return;
        const trimmed = iconRef.trim();
        if (!trimmed) return;

        // 预设图标名不需要下载
        if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed)) return;

        // 规范化路径
        const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
        const iconUrl = `${baseUrl}/${normalized}`;

        try {
            const resp = await fetch(iconUrl);
            if (!resp.ok) {
                console.warn(`[debug-plugin] 图标下载失败: ${iconUrl} (status: ${resp.status})`);
                return;
            }
            const blob = await resp.blob();
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);

            const iconPath = `${pluginDir}/${normalized}`;
            const { dirname } = await import('@tauri-apps/api/path');
            const parentDir = await dirname(iconPath);
            await mkdir(parentDir, { recursive: true });
            await writeFile(iconPath, bytes);
            console.log(`[debug-plugin] 图标下载成功: ${iconUrl}`);
        } catch (e) {
            console.warn(`[debug-plugin] 图标下载异常: ${iconUrl}`, e);
        }
    }

    // 下载插件图标
    if (manifest.icon) {
        await downloadIcon(manifest.icon);
    }
    // 下载菜单图标
    if (manifest.menu?.icon) {
        await downloadIcon(manifest.menu.icon);
    }
}
