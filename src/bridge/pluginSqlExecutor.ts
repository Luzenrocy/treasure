/**
 * @file 插件 SQL 安全执行器
 *
 * 职责：
 *   1. 接收来自 pluginBridge.ts 的 SQL 请求（已通过表名重写）
 *   2. 调用 validateSqlSecurity 进行安全规则二次校验
 *   3. 根据 action 类型分发到 query / execute / transaction
 *
 * 安全边界：
 *   - 插件只能操作 plugin_{pluginCode}_ 前缀的表
 *   - 禁止 DROP / ALTER / RENAME TABLE 等高危操作
 *   - 禁止访问平台核心表（tp_*, sys_migration 等）
 *
 * 调用链路：
 *   pluginBridge.ts (action 分发)
 *     → rewriteWithDeclaredTables (表名重写)
 *     → PluginSqlExecutor.executeRequest (安全校验 + 执行)
 *       → validateSqlSecurity (二次校验)
 *       → sql/common.ts query / execute / transaction (实际执行)
 *
 * @packageDocumentation
 */

import { Response } from '@/class';
import { validateSqlSecurity } from './sqlSecurity';
import { query, execute, transaction } from '@/sql/common';

/**
 * 插件 SQL 安全执行器
 *
 * 插件 iframe 通过 postMessage 请求数据库操作时，由本执行器安全地执行。
 * 多次执行之间通过 dbClient 的连接池管理连接，无需手动释放。
 *
 * @see validateSqlSecurity SQL 安全校验规则定义
 * @see sql/common.ts 底层 SQL 执行门禁
 */
export class PluginSqlExecutor {
    /**
     * 安全地执行插件 SQL 请求
     *
     * 执行流程：
     *   1. validateSqlSecurity 校验操作类型和表名前缀
     *   2. 根据 action 调用对应的 handler
     *
     * @param pluginCode - 插件编码（用于安全规则校验）
     * @param action     - 操作类型（query/insert/update/remove/ddl/transaction）
     * @param sql        - 已重写的 SQL 语句（含 plugin_{code}_ 前缀）
     * @param params     - SQL 参数（? 占位符对应的值）
     *
     * @returns Response { code: 1=成功, 0=错误, msg=错误消息 }
     */
    async executeRequest(
        pluginCode: string,
        action: string,
        sql: string,
        params: any[] = []
    ): Promise<Response> {
        // 第 1 步：安全校验（transaction 由上层逐条校验，此处跳过空 SQL 校验）
        if (action !== 'transaction') {
            const security = validateSqlSecurity(sql, action, pluginCode);
            if (!security.valid) {
                return Response.error(security.error || 'SQL安全校验失败');
            }
        }

        // 第 2 步：根据 action 分发执行
        switch (action) {
            case 'query':
                return this.handleQuery(sql, params);
            case 'execute':
            case 'insert':
                return this.handleInsert(sql, params);
            case 'update':
                return this.handleUpdate(sql, params);
            case 'remove':
                return this.handleDelete(sql, params);
            case 'ddl':
                return this.handleDDL(sql);
            case 'transaction':
                return this.handleTransaction(params, pluginCode);
            default:
                return Response.error(`未知操作: ${action}`);
        }
    }

    /** 处理 SELECT 查询 */
    private async handleQuery(sql: string, params: any[]): Promise<Response> {
        return query(sql, params);
    }

    /** 处理 INSERT 语句 */
    private async handleInsert(sql: string, params: any[]): Promise<Response> {
        return execute(sql, params);
    }

    /** 处理 UPDATE 语句 */
    private async handleUpdate(sql: string, params: any[]): Promise<Response> {
        return execute(sql, params);
    }

    /** 处理 DELETE 语句 */
    private async handleDelete(sql: string, params: any[]): Promise<Response> {
        return execute(sql, params);
    }

    /** 处理 DDL 语句（仅允许 CREATE TABLE） */
    private async handleDDL(sql: string): Promise<Response> {
        return execute(sql);
    }

    /**
     * 处理事务操作
     *
     * 事务中每条 SQL 需单独校验安全规则。
     *
     * @param ops - 事务操作列表，每条包含 sql 和 params
     * @param pluginCode - 插件编码
     */
    private async handleTransaction(ops: Array<{ sql: string; params?: any[] }>, pluginCode: string): Promise<Response> {
        // 逐条校验事务中的 SQL
        for (const op of ops) {
            const security = validateSqlSecurity(op.sql, 'transaction', pluginCode);
            if (!security.valid) {
                return Response.error(`事务中 SQL 校验失败: ${security.error}`);
            }
        }

        return transaction(ops);
    }
}