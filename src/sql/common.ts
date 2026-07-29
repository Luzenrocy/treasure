/**
 * @file SQL 执行门禁 —— 统一 SQL 执行入口
 *
 * 职责：
 *   1. 门禁检查：所有 SQL 执行前先确保数据库迁移已完成
 *   2. 统一转发：将 query / execute / transaction 等请求转发到 dbClient
 *   3. 工具函数：SQL 分割、批量删除构建等
 *
 * 本模块是宿主和插件 SQL 操作的统一入口点。
 * 插件 SQL 经过安全校验和表名重写后，最终通过此模块执行。
 *
 * 调用链路：
 *   pluginBridge.ts
 *     → rewriteWithDeclaredTables
 *     → PluginSqlExecutor.executeRequest
 *     → validateSqlSecurity
 *     → 本模块（query / execute / transaction）
 *       → dbClient（实际数据库操作）
 *
 * @packageDocumentation
 */

import { Response } from '@/class';
import { invoke } from '@tauri-apps/api/core';
import * as dbClient from '@/sql/dbClient';

/**
 * 门禁：所有 SQL 出口先确保迁移就绪，未就绪不触库
 *
 * 通过 invoke('db_ready') 直接查询 Rust 端数据库状态。
 */
async function guard(): Promise<boolean> {
    try {
        const r = await invoke<{ ready: boolean }>('db_ready');
        return r.ready === true;
    } catch {
        return false;
    }
}

/**
 * 执行 SELECT 查询
 *
 * @param sql    - SQL 查询语句
 * @param params - SQL 参数（? 占位符对应的值）
 *
 * @returns Response，成功时 data 为行数组
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<Response> {
    if (!(await guard())) return Response.error('数据库尚未就绪');
    return dbClient.query<T>(sql, params);
}

/**
 * 执行写操作（INSERT / UPDATE / DELETE）
 *
 * @param sql    - SQL 语句
 * @param params - SQL 参数
 *
 * @returns Response，成功时 data 包含 rowsAffected
 */
export async function execute(sql: string, params: any[] = []): Promise<Response> {
    if (!(await guard())) return Response.error('数据库尚未就绪');
    return dbClient.execute(sql, params);
}

/**
 * 执行 DDL 语句（CREATE TABLE / ALTER TABLE 等）
 * DDL 文本可能含多条语句（以分号分割），自动拆解后原子执行。
 *
 * @param sql - DDL 语句文本
 *
 * @returns Response
 */
export async function ddl(sql: string): Promise<Response> {
    if (!(await guard())) return Response.error('数据库尚未就绪');
    // 拆分多条 DDL，用 transaction 原子执行
    const stmts = splitSqlStatements(sql).map(s => ({ sql: s }));
    if (stmts.length === 0) return Response.ok({ rowsAffected: 0 });
    return dbClient.transaction(stmts);
}

/**
 * 执行事务（多条 SQL 原子提交）
 *
 * 所有操作在同一数据库连接中执行，任一失败自动回滚。
 *
 * @param operations - 事务操作列表，每条包含 sql 和可选的 params
 *
 * @returns Response
 */
export async function transaction(operations: { sql: string; params?: any[] }[]): Promise<Response> {
    if (!(await guard())) return Response.error('数据库尚未就绪');
    return dbClient.transaction(operations);
}

/**
 * 将 SQL 文本分割为独立的语句（按 ; 分割）
 *
 * 支持：
 *   - 单引号字符串内的分号不分割
 *   - SQL 注释（-- 行注释 和 /* 块注释 *​/）
 *   - 连续空行和换行符处理
 *
 * @param sqlText - 包含多条 SQL 语句的文本（如 init.sql 内容）
 *
 * @returns SQL 语句数组（已去除首尾空白）
 *
 * @example
 * ```typescript
 * splitSqlStatements(`
 *   CREATE TABLE notes (id INTEGER PRIMARY KEY);
 *   INSERT INTO notes VALUES (1);
 * `)
 * // → ['CREATE TABLE notes (id INTEGER PRIMARY KEY)', 'INSERT INTO notes VALUES (1)']
 * ```
 */
export function splitSqlStatements(sqlText: string): string[] {
    const stmts: string[] = [];
    let buf = '';
    let inSingle = false;  // 是否在单引号字符串内
    const n = sqlText.length;
    let i = 0;
    while (i < n) {
        const ch = sqlText[i];
        if (inSingle) {
            buf += ch;
            // SQL 中 '' 是转义的单引号
            if (ch === "'") {
                if (sqlText[i + 1] === "'") { buf += "'"; i += 2; continue; }
                inSingle = false;
            }
            i++; continue;
        }
        if (ch === "'") { inSingle = true; buf += ch; i++; continue; }
        // -- 行注释：跳过到行尾（不清除 buf，注释属于当前语句的一部分）
        if (ch === '-' && sqlText[i + 1] === '-') {
            const nl = sqlText.indexOf('\n', i);
            i = nl === -1 ? n : nl + 1;
            continue;
        }
        // /* 块注释：跳过到 */
        if (ch === '/' && sqlText[i + 1] === '*') {
            let end = i + 2;
            while (end < n && !(sqlText[end] === '*' && sqlText[end + 1] === '/')) end++;
            i = end + 2 > n ? n : end + 2;
            continue;
        }
        // 分号 = 语句结束
        if (ch === ';') {
            if (buf.trim()) { stmts.push(buf.trim()); buf = ''; }
            i++; continue;
        }
        // 换行符替换为空格
        if (ch === '\n' || ch === '\r') { buf += ' '; i++; continue; }
        buf += ch; i++;
    }
    if (buf.trim()) stmts.push(buf.trim());
    return stmts;
}

/**
 * 构建批量删除 SQL（DELETE FROM table WHERE column IN (?,?,?)）
 *
 * @param table  - 表名
 * @param column - 列名
 * @param ids    - ID 数组
 *
 * @returns { sql: string, params: number[] }
 */
export function buildBatchDeleteSql(table: string, column: string, ids: number[]): { sql: string; params: number[] } {
    const placeholders = ids.map(() => '?').join(',');
    return { sql: `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`, params: ids };
}

/**
 * 批量删除封装
 *
 * 先检查 ids 是否为空，为空时直接返回成功（避免 SQL 语法错误）。
 *
 * @param table  - 表名
 * @param column - 列名
 * @param ids    - 要删除的 ID 数组
 */
export async function batchDelete(table: string, column: string, ids: number[]): Promise<Response> {
    if (ids.length === 0) return Response.ok({ deleted: 0 });
    const { sql, params } = buildBatchDeleteSql(table, column, ids);
    return execute(sql, params);
}