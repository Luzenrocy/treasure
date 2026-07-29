/**
 * @file SQL 表名重写器
 *
 * 职责：
 *   将插件 SQL 中声明的裸表名重写为带前缀的完整表名，实现插件间的数据隔离。
 *
 * 重写规则：
 *   输入：SELECT * FROM notes WHERE id = ?
 *   输出：SELECT * FROM "plugin_shi_yu_lu_notes" WHERE id = ?
 *
 * 前缀格式：plugin_{pluginCode}_{tableName}
 * 其中 pluginCode 来自 manifest.json 的 name 字段，tableName 是插件声明中的裸表名。
 *
 * 调用链路：
 *   pluginBridge.ts (action 分发)
 *     → rewriteWithDeclaredTables  ← 此文件
 *     → PluginSqlExecutor.executeRequest
 *     → sql/common.ts
 *
 * @packageDocumentation
 *
 * @deprecated 正则替换存在潜在注入风险（参见 1784269830958-sql-fixes.md 修复项 3）。
 * 当前依赖 manifest.json 表名校验规则（/^[a-z][a-z0-9-]*$/）作为短期缓解。
 * 长期方案：Rust verify_sql command 在 AST 级别完成表名替换，此函数随后退役。
 */

/**
 * 将插件声明的裸表名重写为带前缀的完整表名
 *
 * 每个表名被替换为 `"plugin_{pluginCode}_{table}"` 格式，包含双引号以支持特殊字符。
 * 如果表名已包含前缀，则跳过替换（避免重复处理）。
 *
 * @param sql            - 原始 SQL 语句（插件传递的 SQL，裸表名）
 * @param declaredTables - 插件声明的表名列表（如 ['notes', 'tags']）
 * @param pluginCode     - 插件编码（如 'shi-yu-lu'）
 *
 * @returns 重写后的 SQL 语句，所有 declaredTables 中的表名已被替换为带前缀的格式
 *
 * @example
 * ```typescript
 * rewriteWithDeclaredTables(
 *   'SELECT * FROM notes JOIN tags ON notes.id = tags.note_id',
 *   ['notes', 'tags'],
 *   'shi-yu-lu'
 * )
 * // → 'SELECT * FROM "plugin_shi_yu_lu_notes" JOIN "plugin_shi_yu_lu_tags" ON ...'
 * ```
 */
export function rewriteWithDeclaredTables(sql: string, declaredTables: string[], pluginCode: string): string {
  const prefix = `"plugin_${pluginCode}_`;
  let result = sql;
  for (const table of declaredTables) {
    // 跳过已包含前缀的表名（防止重复处理）
    if (result.includes(prefix + table + '"')) continue;
    // 转义正则特殊字符，确保表名中的特殊字符被正确处理
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 全局替换（gi）：不区分大小写，匹配整个单词边界
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), prefix + table + '"');
  }
  return result;
}