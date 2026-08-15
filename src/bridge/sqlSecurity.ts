/**
 * @file SQL 安全校验模块
 *
 * 职责：
 *   1. 定义插件 SQL 的安全执行规则
 *   2. 校验插件提交的 SQL 是否符合安全规范
 *   3. Rust AST 已完成表引用、CTE 与命名空间校验；此处不再使用前端正则决定表安全性
 *
 * 安全策略：
 *   - 插件只能操作 plugin_{pluginCode}_ 前缀的的表
 *   - 禁止操作平台核心表（tp_*, sys_* 等）
 *   - 禁止 DROP / ALTER / RENAME TABLE 等高危操作
 *   - 表结构仅由安装/升级迁移处理，运行时插件请求禁止 DDL
 *
 * 调用链路：
 *   pluginBridge.ts
 *     → verify_sql(Rust)   ← 表声明完整性检查
 *     → prepare_plugin_sql (Rust AST)
 *     → PluginSqlExecutor.executeRequest
 *       → validateSqlSecurity  ← 此文件
 *       → sql/common.ts
 *
 * @packageDocumentation
 */

/**
 * SQL 安全执行规则配置
 */
export interface SecurityRule {
    /** 允许的表前缀（插件自定义表必须以指定前缀开头） */
    allowedTablePrefixes: string[];
    /** 禁止操作的表名列表（全匹配） */
    forbiddenTables: string[];
    /** 允许的 SQL 操作类型（如 SELECT, INSERT 等） */
    allowedOperations: string[];
    /** 是否需要绑定 plugin_id 参数（预留，当前未使用） */
    requirePluginId: boolean;
}

/**
 * 平台核心表（插件绝对禁止操作）
 *
 * 这些表由宿主系统使用，包含插件元数据、系统配置、审计日志等敏感信息。
 * 任何插件 SQL 中包含这些表名都会被拒绝。
 */
export const PLATFORM_FORBIDDEN_TABLES = [
    'sys_migration',     // 数据库迁移记录
    'tp_plugin',         // 插件注册表
    'tp_menu',           // 菜单配置
    'tp_setting',        // 系统配置
    'treasure_sql',      // SQL 记录
    'treasure_version',  // 版本信息
    'treasure_menu',     // 菜单（旧版）
    'treasure_plugin',   // 插件（旧版）
    'treasure_setting'   // 设置（旧版）
];

/**
 * 获取指定插件的安全规则
 *
 * 每个插件只能操作以 `plugin_{pluginCode}_` 为前缀的表，
 * 从而天然隔离不同插件之间的数据。
 *
 * @param pluginCode - 插件编码（如 'shi-yu-lu'）
 * @returns SecurityRule 规则对象
 */
export function getSecurityRule(pluginCode: string): SecurityRule {
    const rule = {
        allowedTablePrefixes: [`plugin_${pluginCode}_`],
        forbiddenTables: PLATFORM_FORBIDDEN_TABLES,
        allowedOperations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
        requirePluginId: false
    };
    return rule;
}

/**
 * SQL 安全校验
 *
 * 校验流程：
 *   1. 过滤高危 DDL 操作（DROP / ALTER / RENAME TABLE）
 *   2. 检查操作类型是否在允许列表中
 *   3. 表引用和命名空间由 `prepare_plugin_sql`（Rust AST）作为唯一权威校验
 *
 * @param sql        - 待校验的 SQL 语句（已重写，含 plugin_{code}_ 前缀）
 * @param _action    - 操作类型（预留，当前未使用）
 * @param pluginCode - 插件编码
 *
 * @returns { valid: true } 或 { valid: false, error: "原因" }
 */
export function validateSqlSecurity(
    sql: string,
    _action: string,
    pluginCode: string
): { valid: boolean; error?: string } {
    const rule = getSecurityRule(pluginCode);
    const normalized = sql.trim().toUpperCase();
    console.debug('[SQL Security] 校验 SQL:', sql.substring(0, 300), 'pluginCode:', pluginCode);

    // ── 第 1 步：操作类型校验 ──────────────────────────────
    // 优先匹配双词操作（CREATE TABLE, DROP TABLE, ALTER TABLE, RENAME TABLE）
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    const TWO_WORD_OPS = ['CREATE TABLE', 'DROP TABLE', 'ALTER TABLE', 'RENAME TABLE'];
    let operation: string;

    if (normalized.startsWith('WITH')) {
      // CTE SQL：找到最后一个右括号后的第一个操作类型
      const lastParenIndex = normalized.lastIndexOf(')');
      if (lastParenIndex !== -1) {
        const afterCte = normalized.substring(lastParenIndex + 1).trim();
        const afterCteWords = afterCte.split(/\s+/).filter(w => w.length > 0);
        const firstTwo = afterCteWords.slice(0, 2).join(' ');
        operation = TWO_WORD_OPS.includes(firstTwo) ? firstTwo : afterCteWords[0] || '';
      } else {
        operation = words[0] || '';
      }
    } else {
      const firstTwo = words.slice(0, 2).join(' ');
      operation = TWO_WORD_OPS.includes(firstTwo) ? firstTwo : words[0] || '';
    }
    if (!rule.allowedOperations.includes(operation)) {
        console.error('[SQL Security] 不允许的操作类型:', operation, 'SQL:', sql.substring(0, 200));
        return { valid: false, error: `不允许的操作类型: ${operation}` };
    }

    return { valid: true };
}
